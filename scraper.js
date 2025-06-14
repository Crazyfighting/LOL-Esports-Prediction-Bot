const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs").promises; // 使用 promises 版本
const path = require("path");
const { exec } = require("child_process");

class MatchScraper {
    constructor() {
        this.baseUrl = "https://lol.fandom.com/api.php";
        this.leagues = {
            LCK: "LCK",
            LPL: "LPL",
            LEC: "LEC",
            LTA: "LTA NORTH",
            LCP: "LCP",
            MSI: "MSI",
            Worlds: "Worlds",
        };
        this.cacheDir = path.join(__dirname, "..", "cache", "team_logos"); // 儲存快取圖片的路徑
        this.ensureCacheDirExists();
    }

    async ensureCacheDirExists() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            console.log(`已確認快取目錄存在: ${this.cacheDir}`);
        } catch (error) {
            console.error(`創建快取目錄失敗: ${error}`);
        }
    }

    async getTeamLogoUrl(teamName) {
        // 使用標準的 Leaguepedia 圖片命名格式
        const filename = `${teamName} logo profile.png`;
        console.log(
            `DEBUG: 正在獲取 ${teamName} 的圖片 URL，目標檔案名: File:${filename}`,
        );

        try {
            const response = await axios.get(this.baseUrl, {
                params: {
                    action: "query",
                    format: "json",
                    titles: `File:${filename}`, // 使用新的檔案名稱格式進行 API 查詢
                    prop: "imageinfo",
                    iiprop: "url",
                    iiurlwidth: 100, // 請求縮圖 URL，方便顯示
                },
            });

            const pages = response.data.query.pages;
            const pageId = Object.keys(pages)[0];

            if (pageId === "-1") {
                console.error(
                    `ERROR: 圖片檔案 'File:${filename}' (隊伍: ${teamName}) 在 Leaguepedia 上不存在。`,
                );
                console.error(
                    `DEBUG: Leaguepedia API 完整響應資料:`,
                    JSON.stringify(response.data),
                );
                return null;
            }

            if (
                pages[pageId] &&
                pages[pageId].imageinfo &&
                pages[pageId].imageinfo.length > 0
            ) {
                const imageUrl =
                    pages[pageId].imageinfo[0].thumburl ||
                    pages[pageId].imageinfo[0].url;
                console.log(
                    `DEBUG: 成功找到 ${teamName} 的圖片 URL: ${imageUrl}`,
                );
                return imageUrl;
            } else {
                console.error(
                    `ERROR: 未能在隊伍 ${teamName} 的 API 響應中找到有效的圖片信息。Page ID: ${pageId}。頁面資料:`,
                    JSON.stringify(pages[pageId]),
                );
                return null;
            }
        } catch (error) {
            console.error(
                `ERROR: 獲取 ${teamName} 隊伍圖片 URL 失敗。錯誤:`,
                error.message,
            );
            if (error.response) {
                console.error(
                    `ERROR: API 響應狀態: ${error.response.status}, 數據:`,
                    JSON.stringify(error.response.data),
                );
            }
            return null;
        }
    }

    async getOrCacheTeamLogo(teamName) {
        const localPath = path.join(this.cacheDir, `${teamName}.png`);
        console.log(
            `嘗試獲取或快取 ${teamName} 的 Logo，本地路徑: ${localPath}`,
        );

        try {
            // 檢查本地是否已快取
            await fs.access(localPath);
            console.log(`${teamName} 的 Logo 已存在快取: ${localPath}`);
            return localPath; // 已快取，直接返回本地路徑
        } catch (error) {
            console.log(
                `${teamName} 的 Logo 不在快取中，正在從 Leaguepedia 獲取...`,
            );

            // 調用 Python 腳本下載圖片
            const pythonScript = path.join(__dirname, "download_logos.py");

            return new Promise((resolve, reject) => {
                exec(
                    `python "${pythonScript}" "${teamName}"`,
                    (error, stdout, stderr) => {
                        if (error) {
                            console.error(
                                `執行 Python 腳本時發生錯誤: ${error}`,
                            );
                            reject(error);
                            return;
                        }

                        // 檢查 Python 腳本的輸出
                        if (stdout.includes("SUCCESS")) {
                            console.log(`成功下載 ${teamName} 的 Logo`);
                            resolve(localPath);
                        } else {
                            console.error(`下載 ${teamName} 的 Logo 失敗`);
                            reject(new Error(`無法下載 ${teamName} 的 Logo`));
                        }
                    },
                );
            });
        }
    }

    async getTodayAndTomorrowMatches() {
        try {
            const allMatches = [];

            try {
                console.log("正在獲取未來24小時的比賽資料...");

                // 構建聯賽條件，使用更精確的匹配
                const leagueConditions = Object.values(this.leagues)
                    .map(
                        (league) =>
                            `OverviewPage = '${league}' OR OverviewPage LIKE '${league}/%'`,
                    )
                    .join(" OR ");

                // 構建完整的查詢條件
                const where = `DateTime_UTC >= NOW() AND DateTime_UTC <= DATE_ADD(NOW(), INTERVAL 48 HOUR) AND (${leagueConditions})`;

                console.log("查詢條件:", where);

                const response = await axios.get(this.baseUrl, {
                    params: {
                        action: "cargoquery",
                        format: "json",
                        tables: "MatchSchedule",
                        fields: "Team1,Team2,DateTime_UTC,BestOf,Team1Score,Team2Score,MatchId,OverviewPage",
                        where,
                        order_by: "DateTime_UTC ASC",
                    },
                });

                if (response.data && response.data.cargoquery) {
                    const matches = response.data.cargoquery;
                    console.log(
                        `成功獲取比賽資料，共 ${matches.length} 場比賽`,
                    );

                    // 輸出所有不同的聯賽名稱
                    const uniqueLeagues = new Set();
                    matches.forEach((match) => {
                        const leagueName =
                            match.title.OverviewPage.split("/")[0];
                        uniqueLeagues.add(leagueName);
                    });

                    console.log("\n找到的主要聯賽名稱：");
                    uniqueLeagues.forEach((league) => {
                        console.log(`- ${league}`);
                    });

                    for (const match of matches) {
                        const matchData = match.title;
                        const leagueName = matchData.OverviewPage.split("/")[0];

                        // 檢查是否有 TBD 隊伍
                        if (
                            matchData.Team1.includes("TBD") ||
                            matchData.Team2.includes("TBD")
                        ) {
                            console.log(
                                `跳過比賽：${matchData.Team1} vs ${matchData.Team2}（包含 TBD 隊伍）`,
                            );
                            continue;
                        }

                        const matchInfo = this.parseLeaguepediaMatch(matchData);
                        matchInfo.league = leagueName;
                        allMatches.push(matchInfo);
                    }
                } else {
                    console.log("目前沒有比賽資料");
                }
            } catch (error) {
                console.error("獲取比賽資料錯誤:", error.message);
                if (error.response) {
                    console.error("狀態碼:", error.response.status);
                    console.error("回應資料:", error.response.data);
                }
            }

            // 按時間排序
            return allMatches.sort(
                (a, b) => new Date(a.time) - new Date(b.time),
            );
        } catch (error) {
            console.error("爬取比賽資料錯誤:", error);
            return [];
        }
    }

    parseLeaguepediaMatch(matchData) {
        const format =
            matchData.BestOf === "3"
                ? "BO3"
                : matchData.BestOf === "5"
                  ? "BO5"
                  : "BO1";
        const time = new Date(`${matchData["DateTime UTC"]}Z`).toISOString();
        const leagueName = matchData.OverviewPage.split("/")[0];
        const uniqueId = `${leagueName}_${matchData.Team1}_${matchData.Team2}`;
        return {
            id: matchData.MatchId, // 直接用 Leaguepedia 的 MatchId
            uniqueId: uniqueId, // 保留自組 id 以防萬一
            team1: matchData.Team1,
            team2: matchData.Team2,
            time: time,
            tournament: matchData.OverviewPage,
            format: format,
            league: leagueName,
        };
    }

    async getMatchResult(matchId) {
        try {
            const response = await axios.get(this.baseUrl, {
                params: {
                    action: "cargoquery",
                    format: "json",
                    tables: "MatchSchedule",
                    fields: "Team1,Team2,Team1Score,Team2Score,DateTime_UTC",
                    where: `MatchId='${matchId}'`,
                },
            });

            if (
                !response.data ||
                !response.data.cargoquery ||
                response.data.cargoquery.length === 0
            ) {
                return null;
            }

            const match = response.data.cargoquery[0].title;
            const matchTime = new Date(match.DateTime_UTC);
            const now = new Date();

            // 如果比賽時間還沒到，返回 null
            if (matchTime > now) {
                return null;
            }

            // 如果沒有比分，表示比賽還沒結束
            if (!match.Team1Score || !match.Team2Score) {
                return null;
            }

            const score1 = parseInt(match.Team1Score);
            const score2 = parseInt(match.Team2Score);
            const winner = score1 > score2 ? match.Team1 : match.Team2;
            const score = `${score1}:${score2}`;

            return {
                finished: true,
                winner,
                score,
            };
        } catch (error) {
            console.error("獲取比賽結果錯誤:", error);
            return null;
        }
    }

    validatePrediction(prediction, format) {
        const regex = /^(\d+):(\d+)$/;
        const match = prediction.match(regex);

        if (!match) {
            return { valid: false, error: "格式錯誤！請使用 num:num 格式" };
        }

        const [, score1, score2] = match;
        const num1 = parseInt(score1);
        const num2 = parseInt(score2);

        if (num1 < 0 || num2 < 0) {
            return { valid: false, error: "分數不能為負數！" };
        }

        const maxWins = format === "BO5" ? 3 : format === "BO3" ? 2 : 1;

        if (num1 > maxWins || num2 > maxWins) {
            return {
                valid: false,
                error: `${format} 最高只能到 ${maxWins} 勝！`,
            };
        }

        if (num1 === maxWins && num2 === maxWins) {
            return { valid: false, error: "兩隊不能同時達到最高勝場！" };
        }

        if (num1 < maxWins && num2 < maxWins) {
            return { valid: false, error: "必須有一隊達到獲勝條件！" };
        }

        return { valid: true };
    }

    async getMatchesInRange(startDate, endDate, finishedOnly = false) {
        const startStr = startDate.toISOString().slice(0, 19).replace("T", " ");
        const endStr = endDate.toISOString().slice(0, 19).replace("T", " ");

        // 構建聯賽條件，使用更精確的匹配
        const leagueConditions = Object.values(this.leagues)
            .map(
                (league) =>
                    `OverviewPage = '${league}' OR OverviewPage LIKE '${league}/%'`,
            )
            .join(" OR ");

        // 構建完整的查詢條件
        let where = `DateTime_UTC >= '${startStr}' AND DateTime_UTC <= '${endStr}' AND (${leagueConditions})`;

        if (finishedOnly) {
            where += " AND Team1Score IS NOT NULL AND Team2Score IS NOT NULL";
        }

        console.log("查詢條件:", where);

        const response = await axios.get(this.baseUrl, {
            params: {
                action: "cargoquery",
                format: "json",
                tables: "MatchSchedule",
                fields: "Team1,Team2,DateTime_UTC,BestOf,Team1Score,Team2Score,MatchId,OverviewPage",
                where,
                order_by: "DateTime_UTC ASC",
            },
        });

        if (response.data && response.data.cargoquery) {
            const matches = response.data.cargoquery
                .map((match) => {
                    const matchData = match.title;
                    const leagueName = matchData.OverviewPage.split("/")[0];

                    // 檢查是否有 TBD 隊伍
                    if (
                        matchData.Team1.includes("TBD") ||
                        matchData.Team2.includes("TBD")
                    ) {
                        console.log(
                            `跳過比賽：${matchData.Team1} vs ${matchData.Team2}（包含 TBD 隊伍）`,
                        );
                        return null;
                    }

                    const matchInfo = this.parseLeaguepediaMatch(matchData);
                    matchInfo.league = leagueName;
                    return matchInfo;
                })
                .filter(Boolean);

            console.log(`找到 ${matches.length} 場符合條件的比賽`);
            return matches;
        }
        return [];
    }

    async checkMatchResult(matchId) {
        try {
            console.log(
                `[checkMatchResult] 正在檢查比賽結果，MatchId: ${matchId}`,
            );
            const response = await axios.get(this.baseUrl, {
                params: {
                    action: "cargoquery",
                    format: "json",
                    tables: "MatchSchedule",
                    fields: "MatchId,Team1,Team2,Team1Score,Team2Score,DateTime_UTC,BestOf",
                    where: `MatchId = "${matchId}"`,
                },
            });

            console.log(
                `[checkMatchResult] API 回應:`,
                JSON.stringify(response.data, null, 2),
            );

            if (
                response.data &&
                response.data.cargoquery &&
                response.data.cargoquery.length > 0
            ) {
                const match = response.data.cargoquery[0].title;
                console.log(`[checkMatchResult] 找到比賽資料:`, match);

                if (match.Team1Score !== null && match.Team2Score !== null) {
                    const team1Score = parseInt(match.Team1Score);
                    const team2Score = parseInt(match.Team2Score);
                    const bestOf = parseInt(match.BestOf);

                    let isValidScore = false;
                    switch (bestOf) {
                        case 1: // BO1
                            isValidScore =
                                (team1Score === 1 || team2Score === 1) &&
                                team1Score + team2Score === 1;
                            break;
                        case 3: // BO3
                            isValidScore =
                                (team1Score === 2 || team2Score === 2) &&
                                team1Score + team2Score <= 3;
                            break;
                        case 5: // BO5
                            isValidScore =
                                (team1Score === 3 || team2Score === 3) &&
                                team1Score + team2Score <= 5;
                            break;
                        default:
                            console.log(
                                `[checkMatchResult] 未知的賽制: ${bestOf}`,
                            );
                            return { isFinished: false };
                    }

                    if (!isValidScore) {
                        console.log(`[checkMatchResult] 比分不符合賽制要求:`, {
                            matchId: match.MatchId,
                            team1: match.Team1,
                            team2: match.Team2,
                            score1: team1Score,
                            score2: team2Score,
                            bestOf,
                        });
                        return { isFinished: false };
                    }

                    const result = {
                        isFinished: true,
                        result: {
                            winner:
                                team1Score > team2Score
                                    ? match.Team1
                                    : match.Team2,
                            score: `${team1Score}:${team2Score}`,
                        },
                    };
                    console.log(`[checkMatchResult] 比賽已結束，結果:`, result);
                    return result;
                } else {
                    console.log(`[checkMatchResult] 比賽尚未有比分:`, {
                        matchId: match.MatchId,
                        team1: match.Team1,
                        team2: match.Team2,
                        score1: match.Team1Score,
                        score2: match.Team2Score,
                        time: match.DateTime_UTC,
                    });
                }
            }

            console.log(`[checkMatchResult] 比賽未結束或找不到資料`);
            return { isFinished: false };
        } catch (error) {
            console.error(
                `[checkMatchResult] 檢查比賽結果時發生錯誤 (${matchId}):`,
                error,
            );
            return { isFinished: false };
        }
    }
}

module.exports = MatchScraper;
