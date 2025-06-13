const sqlite3 = require('sqlite3').verbose();

class Database {
    constructor() {
        this.db = new sqlite3.Database('predictions.db');
        this.init();
    }

    init() {
        this.db.serialize(() => {
            // 使用者統計表
            this.db.run(`
                CREATE TABLE IF NOT EXISTS user_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    perfect INTEGER DEFAULT 0,
                    winner INTEGER DEFAULT 0,
                    failed INTEGER DEFAULT 0,
                    UNIQUE(user_id, guild_id)
                )
            `);

            // 預測記錄表（新結構）
            this.db.run(`
                CREATE TABLE IF NOT EXISTS predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    match_id TEXT NOT NULL,
                    unique_id TEXT,
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    prediction TEXT NOT NULL,
                    match_date TEXT,
                    team1 TEXT,
                    team2 TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 廣播頻道設定表
            this.db.run(`
                CREATE TABLE IF NOT EXISTS iconfig (
                    guild_id TEXT PRIMARY KEY,
                    broadcast_channel_id TEXT
                )
            `);

            // 廣播過的比賽記錄表
            this.db.run(`
                CREATE TABLE IF NOT EXISTS broadcasted_matches (
                    guild_id TEXT NOT NULL,
                    match_id TEXT NOT NULL,
                    match_data TEXT NOT NULL,
                    match_time TEXT,
                    team1 TEXT,
                    team2 TEXT,
                    format TEXT,
                    tournament TEXT,
                    PRIMARY KEY (guild_id, match_id)
                )
            `);
        });
    }

    async getUserStats(userId, guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM user_stats WHERE user_id = ? AND guild_id = ?',
                [userId, guildId],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row || { perfect: 0, winner: 0, failed: 0 });
                }
            );
        });
    }

    async updateUserStats(userId, guildId, status) {
        const stats = await this.getUserStats(userId, guildId);
        
        return new Promise((resolve, reject) => {
            const query = `
                INSERT OR REPLACE INTO user_stats 
                (user_id, guild_id, perfect, winner, failed) 
                VALUES (?, ?, ?, ?, ?)
            `;
            
            const newStats = {
                perfect: stats.perfect + (status === 'perfect' ? 1 : 0),
                winner: stats.winner + (status === 'winner' ? 1 : 0),
                failed: stats.failed + (status === 'failed' ? 1 : 0)
            };

            this.db.run(query, [userId, guildId, newStats.perfect, newStats.winner, newStats.failed], 
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async savePrediction(matchId, userId, guildId, prediction, matchDate = null, team1 = null, team2 = null, uniqueId = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO predictions (match_id, unique_id, user_id, guild_id, prediction, match_date, team1, team2) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [matchId, uniqueId, userId, guildId, prediction, matchDate, team1, team2],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getUserPredictionForMatch(userId, guildId, matchId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM predictions WHERE user_id = ? AND guild_id = ? AND match_id = ?',
                [userId, guildId, matchId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async getMatchPredictions(matchId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM predictions WHERE match_id = ?',
                [matchId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    async getGuildLeaderboard(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT user_id, perfect, winner, failed, 
                        (perfect + winner) as correct_predictions,
                        (perfect + winner + failed) as total_predictions
                 FROM user_stats 
                 WHERE guild_id = ? AND (perfect + winner + failed) > 0
                 ORDER BY perfect DESC, winner DESC, total_predictions DESC
                 LIMIT 10`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    async getUserPredictions(userId, guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM predictions WHERE user_id = ? AND guild_id = ?',
                [userId, guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    async setBroadcastChannel(guildId, channelId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO iconfig (guild_id, broadcast_channel_id) VALUES (?, ?)',
                [guildId, channelId],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getBroadcastChannel(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT broadcast_channel_id FROM iconfig WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.broadcast_channel_id : null);
                }
            );
        });
    }

    async getAllGuildsWithBroadcastChannel() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT guild_id, broadcast_channel_id FROM iconfig WHERE broadcast_channel_id IS NOT NULL',
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    async getBroadcastedMatches(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM broadcasted_matches WHERE guild_id = ?',
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows ? rows.map(row => ({
                        id: row.match_id,
                        data: JSON.parse(row.match_data),
                        time: row.match_time,
                        team1: row.team1,
                        team2: row.team2,
                        format: row.format,
                        tournament: row.tournament
                    })) : []);
                }
            );
        });
    }

    async getSingleBroadcastedMatch(guildId, matchId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM broadcasted_matches WHERE guild_id = ? AND match_id = ?',
                [guildId, matchId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? {
                        id: row.match_id,
                        data: JSON.parse(row.match_data),
                        time: row.match_time,
                        team1: row.team1,
                        team2: row.team2,
                        format: row.format,
                        tournament: row.tournament
                    } : null);
                }
            );
        });
    }

    async addBroadcastedMatch(guildId, matchId, matchData) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO broadcasted_matches (guild_id, match_id, match_data, match_time, team1, team2, format, tournament) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    guildId,
                    matchId,
                    JSON.stringify(matchData),
                    matchData.time,
                    matchData.team1,
                    matchData.team2,
                    matchData.format,
                    matchData.tournament
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async removeBroadcastedMatch(guildId, matchId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM broadcasted_matches WHERE guild_id = ? AND match_id = ?',
                [guildId, matchId],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async updatePrediction(matchId, userId, guildId, prediction) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE predictions 
                SET prediction = ?, 
                    timestamp = CURRENT_TIMESTAMP
                WHERE match_id = ? 
                AND user_id = ? 
                AND guild_id = ?
            `;
            
            this.db.run(query, [prediction, matchId, userId, guildId], function(err) {
                if (err) {
                    console.error('更新預測時發生錯誤:', err);
                    reject(err);
                } else {
                    console.log(`已更新預測: matchId=${matchId}, userId=${userId}, guildId=${guildId}, prediction=${prediction}`);
                    resolve();
                }
            });
        });
    }
}

module.exports = Database; 