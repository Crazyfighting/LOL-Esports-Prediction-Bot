const { Client, GatewayIntentBits, Collection, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { token } = require('./config.json');
const Database = require('./database.js');
const MatchScraper = require('./scraper.js');
const cron = require('node-cron');
const path = require('path');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

class LOLPredictionBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildPresences
            ]
        });
        
        this.db = new Database();
        this.scraper = new MatchScraper();
        
        this.setupEventHandlers();
        this.setupCronJobs();
    }

    setupEventHandlers() {
        this.client.once('ready', () => {
            console.log(`${this.client.user.tag} 已上線！`);
            this.registerCommands();
        });

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            
            if (message.content === '!matches') {
                await this.showUpcomingMatches(message);
            } else if (message.content === '!stats') {
                await this.showUserStats(message);
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isButton()) {
                await this.handlePredictionInteraction(interaction);
            } else if (interaction.isChatInputCommand()) {
                await this.handleSlashCommand(interaction);
            } else if (interaction.isModalSubmit()) {
                await this.handleModalSubmit(interaction);
            }
        });
    }

    async registerCommands() {
        const { REST, Routes } = require('discord.js');
        const { clientId } = require('./config.json');
        
        const commands = [
            {
                name: 'matches',
                description: '顯示今天和明天的比賽'
            },
            {
                name: 'stats',
                description: '查看你的預測統計'
            },
            {
                name: 'leaderboard',
                description: '查看伺服器預測排行榜'
            },
            {
                name: 'mypredictions',
                description: '查看你所有預測過的比賽與比分'
            },
            {
                name: 'setbroadcastchannel',
                description: '設定本伺服器的廣播頻道（僅限管理員）',
                options: [
                    {
                        name: 'channel',
                        description: '要設定的廣播頻道',
                        type: 7, // CHANNEL type
                        required: true
                    }
                ]
            },
            {
                name: 'help',
                description: '顯示機器人使用教學'
            }
        ];

        const rest = new REST().setToken(token);

        try {
            console.log('開始註冊全域斜線命令...');
            
            // 註冊全域命令，所有伺服器都能使用
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );

            console.log('全域斜線命令註冊成功！');
        } catch (error) {
            console.error('註冊命令時發生錯誤:', error);
        }
    }

    setupCronJobs() {
        // 每2分鐘檢查比賽結果
        cron.schedule('*/2 * * * *', async () => {
            await this.checkMatchResults();
        });

        // 每小時更新即將開始的比賽
        cron.schedule('0 * * * *', async () => {
            await this.updateUpcomingMatches();
        });
    }

    async handleSlashCommand(interaction) {
        const { commandName } = interaction;

        switch (commandName) {
            case 'matches':
                await this.showUpcomingMatches(interaction);
                break;
            case 'stats':
                await this.showUserStats(interaction);
                break;
            case 'leaderboard':
                await this.showLeaderboard(interaction);
                break;
            case 'mypredictions':
                await this.showMyPredictions(interaction);
                break;
            case 'setbroadcastchannel':
                await this.setBroadcastChannel(interaction);
                break;
            case 'help':
                await this.showHelp(interaction);
                break;
            default:
                await interaction.reply({ content: '未知的命令！', ephemeral: true });
        }
    }

    async handleModalSubmit(interaction) {
        if (!interaction.customId.startsWith('prediction_')) return;

        // 移除 'prediction_' 前綴，保留完整的比賽 ID
        const matchId = interaction.customId.replace('prediction_', '');
        console.log('Modal 提交，完整 customId:', interaction.customId);
        console.log('解析後的比賽ID:', matchId);
        
        const match = await this.db.getSingleBroadcastedMatch(interaction.guild.id, matchId);
        console.log('找到的比賽資料:', match);
        
        if (!match) {
            console.log('找不到比賽資料，可能原因：');
            console.log('1. 比賽已過期');
            console.log('2. 比賽ID不匹配');
            console.log('3. activeMatches 未正確更新');
            return interaction.reply({ 
                content: '此比賽已不可預測！', 
                ephemeral: true 
            });
        }

        const prediction = interaction.fields.getTextInputValue('prediction');
        console.log('用戶預測:', prediction);
        
        const validation = this.scraper.validatePrediction(prediction, match.format);
        console.log('預測驗證結果:', validation);
        
        if (!validation.valid) {
            return interaction.reply({ 
                content: `預測錯誤：${validation.error}`, 
                ephemeral: true 
            });
        }

        // 檢查是否已經預測過
        const existingPrediction = await this.db.getUserPredictionForMatch(
            interaction.user.id, 
            interaction.guild.id, 
            matchId
        );
        
        if (existingPrediction) {
            // 更新現有預測
            await this.db.updatePrediction(
                matchId,
                interaction.user.id,
                interaction.guild.id,
                prediction
            );
            await interaction.reply({ 
                content: `預測已更新！你預測 ${match.team1} vs ${match.team2} 的比分為 ${prediction}`, 
                ephemeral: true 
            });
        } else {
            // 保存新預測
            await this.db.savePrediction(
                match.id, 
                interaction.user.id, 
                interaction.guild.id, 
                prediction,
                match.time,
                match.team1,
                match.team2,
                match.uniqueId
            );
            await interaction.reply({ 
                content: `預測成功！你預測 ${match.team1} vs ${match.team2} 的比分為 ${prediction}`, 
                ephemeral: true 
            });
        }
    }

    // 共用：產生比賽訊息（embed, button, files）
    async createMatchMessage(match) {
        const { embed, files } = await this.createMatchEmbed(match);
        const button = this.createPredictButton(match.id);
        return { embed, files, button };
    }

    async showUpcomingMatches(interaction) {
        await interaction.deferReply();
        try {
            const matches = await this.scraper.getTodayAndTomorrowMatches();
            if (matches.length === 0) {
                return interaction.followUp('目前沒有即將舉行的比賽！');
            }
            for (const match of matches) {
                console.log('處理比賽:', match);
                const { embed, files, button } = await this.createMatchMessage(match);
                await interaction.followUp({ embeds: [embed], components: [button], files });
                await this.db.addBroadcastedMatch(interaction.guild.id, match.id, match);
            }
        } catch (error) {
            console.error('獲取比賽資料錯誤:', error);
            interaction.followUp('獲取比賽資料時發生錯誤！');
        }
    }

    async showUserStats(interaction) {
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;
        
        const stats = await this.db.getUserStats(userId, guildId);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`${interaction.user.username} 的預測統計`)
            .addFields(
                { name: '完全正確', value: stats.perfect.toString(), inline: true },
                { name: '勝方正確', value: stats.winner.toString(), inline: true },
                { name: '預測失敗', value: stats.failed.toString(), inline: true },
                { name: '總預測次數', value: (stats.perfect + stats.winner + stats.failed).toString(), inline: true }
            );

        await interaction.reply({ embeds: [embed] });
    }

    async showLeaderboard(interaction) {
        const guildId = interaction.guild.id;
        const leaderboard = await this.db.getGuildLeaderboard(guildId);
        
        if (leaderboard.length === 0) {
            return interaction.reply('這個伺服器還沒有預測記錄！');
        }

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle(`${interaction.guild.name} 預測排行榜`)
            .setDescription('前10明燈');

        for (let i = 0; i < Math.min(10, leaderboard.length); i++) {
            const user = leaderboard[i];
            const member = await interaction.guild.members.fetch(user.user_id).catch(() => null);
            const username = member ? member.displayName : `用戶 ${user.user_id}`;
            const total = user.perfect + user.winner + user.failed;
            const accuracy = total > 0 ? ((user.perfect + user.winner) / total * 100).toFixed(1) : '0.0';
            
            embed.addFields({
                name: `${i + 1}. ${username}`,
                value: `準確率: ${accuracy}% | 完全正確: ${user.perfect} | 勝方正確: ${user.winner} | 總預測: ${total}`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    }

    async showMyPredictions(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        // 只查 predictions 資料表
        const predictions = await this.db.getUserPredictions(userId, guildId);

        if (!predictions || predictions.length === 0) {
            await interaction.followUp({ content: '你目前沒有任何預測紀錄！', ephemeral: true });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x00BFFF)
            .setTitle(`${interaction.user.username} 的所有預測紀錄`)
            .setDescription('以下是你所有預測過的比賽：');

        for (const pred of predictions) {
            let value = '';
            if (pred.match_date && pred.team1 && pred.team2) {
                // 格式化日期
                const matchDate = new Date(pred.match_date);
                const localDate = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).format(matchDate);
                value = `日期：${localDate}\n${pred.team1} vs ${pred.team2}\n預測比分：${pred.prediction}`;
            } else {
                value = `${pred.match_id}\n預測比分：${pred.prediction}`;
            }
            embed.addFields({
                name: '\u200B',
                value,
                inline: false
            });
        }

        await interaction.followUp({ embeds: [embed], ephemeral: true });
    }

    async createMatchEmbed(match) {
        const matchDate = new Date(match.time);
        
        // 格式化為台灣本地時間 (UTC+8)
        const localDate = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).format(matchDate);
        const localTime = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(matchDate);

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .addFields(
                { name: '日期', value: localDate, inline: true },
                { name: '時間 (UTC+8)', value: localTime, inline: true },
                { name: '賽制', value: match.format, inline: true },
                { name: '聯賽/系列賽', value: match.tournament, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'LOL Esports Prediction Bot' });

        const files = [];

        // 獲取並快取隊伍 Logo
        const team1LogoPath = await this.scraper.getOrCacheTeamLogo(match.team1);
        const team2LogoPath = await this.scraper.getOrCacheTeamLogo(match.team2);

        if (team1LogoPath && team2LogoPath) {
            const canvasWidth = 800; // 畫布寬度
            const canvasHeight = 150; // 畫布高度
            const logoSize = 100; // Logo 圖片大小
            const vsTextSize = 80; // 'vs' 文字大小，進一步調大
            const padding = 100; // 大幅增加隊伍 Logo 與 "vs" 文字之間的間距

            const canvas = createCanvas(canvasWidth, canvasHeight);
            const context = canvas.getContext('2d');

            // 恢復背景填充
            context.fillStyle = '#1e2124'; 
            context.fillRect(0, 0, canvasWidth, canvasHeight);

            // 載入並繪製隊伍 1 Logo
            const team1Logo = await loadImage(team1LogoPath);
            const team1X = (canvasWidth / 2) - logoSize - (vsTextSize / 2) - padding; // 調整位置
            const team1Y = (canvasHeight - logoSize) / 2;
            context.drawImage(team1Logo, team1X, team1Y, logoSize, logoSize);

            // 載入並繪製隊伍 2 Logo
            const team2Logo = await loadImage(team2LogoPath);
            const team2X = (canvasWidth / 2) + (vsTextSize / 2) + padding; // 調整位置
            const team2Y = (canvasHeight - logoSize) / 2;
            context.drawImage(team2Logo, team2X, team2Y, logoSize, logoSize);

            // 繪製 'vs' 文字
            context.font = `${vsTextSize}px Impact`; // 保持 Impact 字體
            context.fillStyle = '#FFFFFF'; // 白色文字
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText('vs', canvasWidth / 2, canvasHeight / 2);

            // 將畫布轉換為圖片 Buffer
            const buffer = canvas.toBuffer('image/png');
            const matchImageName = 'match_title.png';
            files.push(new AttachmentBuilder(buffer, { name: matchImageName }));
            embed.setImage(`attachment://${matchImageName}`); // 將組合圖片設定為主要圖片
        } else {
            // 如果無法獲取 logo，則退回使用文字標題
            embed.setTitle(`**${match.team1}** vs **${match.team2}**`);
            console.warn(`無法為 ${match.team1} 或 ${match.team2} 載入 logo，使用文字標題。`);
        }

        return { embed, files };
    }

    createPredictButton(matchId) {
        console.log('創建預測按鈕，比賽ID:', matchId);
        const button = new ButtonBuilder()
            .setCustomId(`predict_${matchId}`)
            .setLabel('🎯 進行預測')
            .setStyle(ButtonStyle.Primary);

        return new ActionRowBuilder().addComponents(button);
    }

    async handlePredictionInteraction(interaction) {
        if (!interaction.customId.startsWith('predict_')) return;

        // 移除 'predict_' 前綴，保留完整的比賽 ID
        const matchId = interaction.customId.replace('predict_', '');
        console.log('預測按鈕點擊，完整 customId:', interaction.customId);
        console.log('解析後的比賽ID:', matchId);
        
        const match = await this.db.getSingleBroadcastedMatch(interaction.guild.id, matchId);
        console.log('找到的比賽資料:', match);
        
        if (!match) {
            console.log('找不到比賽資料，可能原因：');
            console.log('1. 比賽已過期');
            console.log('2. 比賽ID不匹配');
            console.log('3. activeMatches 未正確更新');
            return interaction.reply({ content: '此比賽已不可預測！', ephemeral: true });
        }

        // 檢查比賽時間是否已過預測時限（比賽開始後半小時）
        const matchTime = new Date(match.time);
        const now = new Date();
        const predictionDeadline = new Date(matchTime.getTime() + 30 * 60 * 1000); // 比賽時間 + 30分鐘
        
        if (now > predictionDeadline) {
            console.log('已超過預測時限:', {
                matchId,
                matchTime: matchTime.toISOString(),
                predictionDeadline: predictionDeadline.toISOString(),
                now: now.toISOString()
            });
            return interaction.reply({ content: '此比賽已超過預測時限（比賽開始後30分鐘）！', ephemeral: true });
        }

        const modal = this.createPredictionModal(matchId, match.format);
        await interaction.showModal(modal);
    }

    createPredictionModal(matchId, format) {
        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        
        const modal = new ModalBuilder()
            .setCustomId(`prediction_${matchId}`)
            .setTitle('比賽預測');

        const maxWins = format === 'BO5' ? 3 : (format === 'BO3' ? 2 : 1);
        
        const predictionInput = new TextInputBuilder()
            .setCustomId('prediction')
            .setLabel(`預測比分 (格式: num:num, 最高${maxWins}勝)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('例如: 2:1')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(predictionInput));
        return modal;
    }

    async setBroadcastChannel(interaction) {
        try {
            if (!interaction.memberPermissions.has('ADMINISTRATOR')) {
                return interaction.reply({ content: '你沒有足夠的權限執行此命令！', ephemeral: true });
            }

            const channel = interaction.options.getChannel('channel');
            console.log('獲取到的頻道:', channel);

            if (!channel) {
                return interaction.reply({ 
                    content: '請指定一個有效的頻道！', 
                    ephemeral: true 
                });
            }

            if (!interaction.guild) {
                return interaction.reply({
                    content: '無法獲取伺服器資訊！',
                    ephemeral: true
                });
            }

            console.log('正在設定廣播頻道:', {
                guildId: interaction.guild.id,
                channelId: channel.id
            });

            await this.db.setBroadcastChannel(interaction.guild.id, channel.id);
            
            console.log('廣播頻道設定成功');
            
            await interaction.reply({
                content: `廣播頻道已設定為 ${channel}！`,
                ephemeral: false
            });
        } catch (error) {
            console.error('設定廣播頻道時發生錯誤:', error);
            await interaction.reply({
                content: '設定廣播頻道時發生錯誤，請稍後再試！',
                ephemeral: true
            });
        }
    }

    async updateUpcomingMatches() {
        console.log('更新即將開始的比賽...');
        try {
            const guilds = await this.db.getAllGuildsWithBroadcastChannel();

            for (const guildData of guilds) {
                const guildId = guildData.guild_id;
                const channelId = guildData.broadcast_channel_id;
                
                // 改用 fetch 來獲取伺服器
                let guild;
                try {
                    guild = await this.client.guilds.fetch(guildId);
                } catch (error) {
                    console.log(`[updateUpcomingMatches] 無法獲取伺服器: guildId=${guildId}`, error);
                    continue;
                }
                
                if (!guild) {
                    console.log(`[updateUpcomingMatches] 找不到伺服器: guildId=${guildId}`);
                    continue;
                }

                // 改用 fetch 來獲取頻道
                let channel;
                try {
                    channel = await guild.channels.fetch(channelId);
                } catch (error) {
                    console.log(`[updateUpcomingMatches] 無法獲取頻道: guildId=${guildId}, channelId=${channelId}`, error);
                    continue;
                }

                if (!channel) {
                    console.log(`[updateUpcomingMatches] 找不到頻道: guildId=${guildId}, channelId=${channelId}`);
                    continue;
                }

                console.log(`[updateUpcomingMatches] 正在更新伺服器 ${guildId} 的比賽...`);

                const upcomingMatches = await this.scraper.getTodayAndTomorrowMatches();
                const broadcastedMatches = await this.db.getBroadcastedMatches(guildId);
                const broadcastedMatchIds = new Set(broadcastedMatches.map(m => m.id));

                for (const match of upcomingMatches) {
                    if (!broadcastedMatchIds.has(match.id)) {
                        console.log(`[updateUpcomingMatches] 廣播新比賽至伺服器 ${guildId}: ${match.id}`);
                        const { embed, files, button } = await this.createMatchMessage(match);
                        await channel.send({ embeds: [embed], components: [button], files });
                        await this.db.addBroadcastedMatch(guildId, match.id, match);
                    }
                }
            }
        } catch (error) {
            console.error('更新即將開始的比賽時發生錯誤:', error);
        }
    }

    async checkMatchResults() {
        console.log('檢查比賽結果...');
        try {
            // 獲取所有已設定廣播頻道的伺服器
            const guilds = await this.db.getAllGuildsWithBroadcastChannel(); // 假設有這個方法
            
            for (const guild of guilds) {
                const broadcastedMatches = await this.db.getBroadcastedMatches(guild.guild_id);
                
                for (const broadcastedMatch of broadcastedMatches) {
                    const match = broadcastedMatch.data; // 完整的比賽資料
                    const matchId = match.id; // Leaguepedia 原始 MatchId
                    console.log(`檢查伺服器 ${guild.guild_id} 中的比賽結果:`, matchId);
                    
                    // 檢查比賽是否已結束
                    const checkResult = await this.scraper.checkMatchResult(matchId);

                    if (checkResult.isFinished) {
                        console.log(`比賽已結束: ${matchId}`);
                        await this.processMatchResult(match, checkResult.result, guild.guild_id);
                    } else {
                        // console.log(`比賽尚未結束或結果不可用: ${matchId}`); // 減少日誌頻率
                    }
                }
            }
        } catch (error) {
            console.error('檢查比賽結果時發生錯誤:', error);
        }
    }

    async processMatchResult(match, result, guildId) {
        try {
            console.log(`[processMatchResult] 廣播比賽結果: ${match.id}`);
            const predictions = await this.db.getMatchPredictions(match.id);
            // 廣播到綁定頻道
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) {
                try {
                    guild = await this.client.guilds.fetch(guildId);
                } catch (error) {
                    console.warn(`[processMatchResult] 無法 fetch guild: ${guildId}`, error);
                    return;
                }
            }
            const channelId = await this.db.getBroadcastChannel(guildId);
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                console.log(`[processMatchResult] 找不到廣播頻道: guildId=${guildId}, channelId=${channelId}`);
                return;
            }

            const matchDate = new Date(match.time);
            
            // 格式化為台灣本地時間 (UTC+8)
            const localDate = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).format(matchDate);
            const localTime = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(matchDate);

            const resultEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setDescription(`${result.winner} 獲勝！比分: ${result.score}`)
                .addFields(
                    { name: '比賽日期', value: localDate, inline: true },
                    { name: '比賽時間 (UTC+8)', value: localTime, inline: true },
                    { name: '賽制', value: match.format, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'LOL Esports Prediction Bot' });

            const files = [];

            // 獲取並快取隊伍 Logo
            const team1LogoPath = await this.scraper.getOrCacheTeamLogo(match.team1);
            const team2LogoPath = await this.scraper.getOrCacheTeamLogo(match.team2);

            if (team1LogoPath && team2LogoPath) {
                const canvasWidth = 800; // 畫布寬度
                const canvasHeight = 150; // 畫布高度
                const logoSize = 100; // Logo 圖片大小
                const vsTextSize = 80; // 'vs' 文字大小，進一步調大
                const padding = 100; // 大幅增加隊伍 Logo 與 "vs" 文字之間的間距

                const canvas = createCanvas(canvasWidth, canvasHeight);
                const context = canvas.getContext('2d');

                // 恢復背景填充
                context.fillStyle = '#1e2124'; 
                context.fillRect(0, 0, canvasWidth, canvasHeight);

                // 載入並繪製隊伍 1 Logo
                const team1Logo = await loadImage(team1LogoPath);
                const team1X = (canvasWidth / 2) - logoSize - (vsTextSize / 2) - padding; // 調整位置
                const team1Y = (canvasHeight - logoSize) / 2;
                context.drawImage(team1Logo, team1X, team1Y, logoSize, logoSize);

                // 載入並繪製隊伍 2 Logo
                const team2Logo = await loadImage(team2LogoPath);
                const team2X = (canvasWidth / 2) + (vsTextSize / 2) + padding; // 調整位置
                const team2Y = (canvasHeight - logoSize) / 2;
                context.drawImage(team2Logo, team2X, team2Y, logoSize, logoSize);

                // 繪製 'vs' 文字
                context.font = `${vsTextSize}px Impact`; // 保持 Impact 字體
                context.fillStyle = '#FFFFFF'; // 白色文字
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.fillText('vs', canvasWidth / 2, canvasHeight / 2);

                // 將畫布轉換為圖片 Buffer
                const buffer = canvas.toBuffer('image/png');
                const matchImageName = 'result_match_title.png';
                files.push(new AttachmentBuilder(buffer, { name: matchImageName }));
                resultEmbed.setImage(`attachment://${matchImageName}`); // 將組合圖片設定為主要圖片
            } else {
                // 如果無法獲取 logo，則退回使用文字標題
                resultEmbed.setTitle(`比賽結果: **${match.team1}** vs **${match.team2}**`);
                console.warn(`無法為 ${match.team1} 或 ${match.team2} 載入 logo，使用文字標題。`);
            }

            const userResults = [];
            
            for (const prediction of predictions) {
                if (!prediction.user_id) {
                    console.error(`[processMatchResult] 預測記錄缺少 user_id:`, prediction);
                    continue;
                }
                const status = this.evaluatePrediction(prediction.prediction, result);
                await this.db.updateUserStats(prediction.user_id, guildId, status);
                
                const user = await this.client.users.fetch(prediction.user_id);
                userResults.push({
                    user: user.username,
                    prediction: prediction.prediction,
                    status: status
                });
            }

            // 只顯示當前伺服器的結果
            const guildMembers = await guild.members.fetch();
            const filteredResults = userResults.filter(result => 
                guildMembers.has(this.client.users.cache.find(u => u.username === result.user)?.id)
            );

            if (filteredResults.length > 0) {
                const resultsText = filteredResults.map(r => 
                    `${r.user}: ${r.prediction} - ${this.getStatusEmoji(r.status)}`
                ).join('\n');

                resultEmbed.addFields({
                    name: '預測結果',
                    value: resultsText
                });
            }

            await channel.send({ embeds: [resultEmbed], files: files });
            console.log(`[processMatchResult] 已廣播比賽結果: ${match.id} 至頻道 ${channelId}`);

            // 移除已廣播的比賽記錄
            await this.db.removeBroadcastedMatch(guildId, match.id);

        } catch (error) {
            console.error(`處理比賽結果時發生錯誤 ${match.id}:`, error);
        }
    }

    evaluatePrediction(prediction, result) {
        const [pred1, pred2] = prediction.split(':').map(Number);
        const [res1, res2] = result.score.split(':').map(Number);
        
        if (pred1 === res1 && pred2 === res2) {
            return 'perfect';
        } else if ((pred1 > pred2 && res1 > res2) || (pred1 < pred2 && res1 < res2)) {
            return 'winner';
        } else {
            return 'failed';
        }
    }

    getStatusEmoji(status) {
        switch (status) {
            case 'perfect': return '✅ 完全正確';
            case 'winner': return '🎯 勝方正確';
            case 'failed': return '❌ 預測失敗';
            default: return '❓';
        }
    }

    async start() {
        await this.client.login(token);
        console.log('機器人已成功登入 Discord。');
        // 開機時自動檢查並廣播即將開始的比賽
        await this.updateUpcomingMatches();
    }

    async showHelp(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('LOL Esports Prediction Bot 使用教學')
            .setDescription('這是一個英雄聯盟電競比賽預測機器人，可以預測比賽結果並追蹤預測準確度。')
            .addFields(
                { 
                    name: '查看比賽',
                    value: '使用 `/matches` 查看今天和明天的比賽。\n點擊「🎯 進行預測」按鈕來預測比賽結果。',
                    inline: false 
                },
                { 
                    name: '預測規則',
                    value: '預測格式為 `num:num`，例如：\n- BO1：`1:0`\n- BO3：`2:0`、`2:1`\n- BO5：`3:0`、`3:1`、`3:2`',
                    inline: false 
                },
                { 
                    name: '查看統計',
                    value: '使用 `/stats` 查看你的預測統計。\n使用 `/leaderboard` 查看伺服器預測排行榜。\n使用 `/mypredictions` 查看你所有預測過的比賽。',
                    inline: false 
                },
                { 
                    name: '綁定廣播頻道',
                    value: '使用 `/setbroadcastchannel` 設定比賽結果廣播頻道。',
                    inline: false 
                }
            )
            .setFooter({ text: 'LOL Esports Prediction Bot' });

        await interaction.reply({ embeds: [embed] });
    }

    async showPastMatches(interaction) {
        try {
            if (!interaction.memberPermissions.has('ADMINISTRATOR')) {
                return interaction.reply({ content: '你沒有足夠的權限執行此命令！', ephemeral: true });
            }

            await interaction.deferReply();

            const days = interaction.options.getInteger('days');
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

            console.log('獲取過去比賽:', {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                days
            });

            const matches = await this.scraper.getMatchesInRange(startDate, endDate, true);
            console.log(`找到 ${matches.length} 場過去比賽`);

            if (matches.length === 0) {
                return interaction.followUp('在指定時間範圍內沒有找到任何比賽！');
            }

            for (const match of matches) {
                const { embed, files, button } = await this.createMatchMessage(match);
                await interaction.followUp({ embeds: [embed], components: [button], files });
                await this.db.addBroadcastedMatch(interaction.guild.id, match.id, match);
            }
        } catch (error) {
            console.error('獲取過去比賽時發生錯誤:', error);
            await interaction.reply('獲取過去比賽時發生錯誤，請稍後再試！');
        }
    }
}

// 啟動機器人
const bot = new LOLPredictionBot();
bot.start();

// 添加健康檢查端點
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 啟動 Express 伺服器
app.listen(port, () => {
    console.log(`健康檢查伺服器運行在 port ${port}`);
});