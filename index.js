const { Client, GatewayIntentBits, Collection, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { token } = require('./config.json');
const Database = require('./database.js');
const MatchScraper = require('./scraper.js');
const cron = require('node-cron');

class LOLPredictionBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });
        
        this.db = new Database();
        this.scraper = new MatchScraper();
        this.activeMatches = new Map();
        this.predictions = new Map();
        
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
        // 每5分鐘檢查比賽結果
        cron.schedule('*/5 * * * *', async () => {
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
            default:
                await interaction.reply({ content: '未知的命令！', ephemeral: true });
        }
    }

    async handleModalSubmit(interaction) {
        if (!interaction.customId.startsWith('prediction_')) return;

        const matchId = interaction.customId.split('_')[1];
        const match = this.activeMatches.get(matchId);
        
        if (!match) {
            return interaction.reply({ 
                content: '此比賽已不可預測！', 
                ephemeral: true 
            });
        }

        const prediction = interaction.fields.getTextInputValue('prediction');
        const validation = this.scraper.validatePrediction(prediction, match.format);
        
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
            return interaction.reply({ 
                content: '你已經對這場比賽進行過預測了！', 
                ephemeral: true 
            });
        }

        // 保存預測
        await this.db.savePrediction(
            matchId, 
            interaction.user.id, 
            interaction.guild.id, 
            prediction
        );

        await interaction.reply({ 
            content: `預測成功！你預測 ${match.team1} vs ${match.team2} 的比分為 ${prediction}`, 
            ephemeral: true 
        });
    }
    async showUpcomingMatches(interaction) {
        await interaction.deferReply();
        
        try {
            const matches = await this.scraper.getTodayAndTomorrowMatches();
            
            if (matches.length === 0) {
                return interaction.followUp('目前沒有即將舉行的比賽！');
            }

            for (const match of matches) {
                const embed = this.createMatchEmbed(match);
                const button = this.createPredictButton(match.id);
                
                await interaction.followUp({
                    embeds: [embed],
                    components: [button]
                });
                
                this.activeMatches.set(match.id, {
                    ...match,
                    guildId: interaction.guild.id,
                    channelId: interaction.channel.id
                });
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
            .setDescription('前10名預測高手');

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

    createMatchEmbed(match) {
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(`${match.team1} vs ${match.team2}`)
            .addFields(
                { name: '比賽時間', value: match.time, inline: true },
                { name: '賽制', value: match.format, inline: true },
                { name: '系列賽', value: match.tournament, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'LOL Esports Prediction Bot' });

        return embed;
    }

    createPredictButton(matchId) {
        const button = new ButtonBuilder()
            .setCustomId(`predict_${matchId}`)
            .setLabel('🎯 進行預測')
            .setStyle(ButtonStyle.Primary);

        return new ActionRowBuilder().addComponents(button);
    }

    async handlePredictionInteraction(interaction) {
        const matchId = interaction.customId.split('_')[1];
        const match = this.activeMatches.get(matchId);
        
        if (!match) {
            return interaction.reply({ content: '此比賽已不可預測！', ephemeral: true });
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
        for (const [matchId, match] of this.activeMatches) {
            const result = await this.scraper.getMatchResult(matchId);
            
            if (result && result.finished) {
                await this.processMatchResult(matchId, result);
                this.activeMatches.delete(matchId);
            }
        }
    }

    async processMatchResult(matchId, result) {
        const predictions = await this.db.getMatchPredictions(matchId);
        const match = this.activeMatches.get(matchId);
        
        if (!match) return;

        const guild = this.client.guilds.cache.get(match.guildId);
        const channel = guild?.channels.cache.get(match.channelId);
        
        if (!channel) return;

        const resultEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('比賽結果')
            .setDescription(`${result.winner} 獲勝！比分: ${result.score}`)
            .setTimestamp();

        const userResults = [];
        
        for (const prediction of predictions) {
            const status = this.evaluatePrediction(prediction.prediction, result);
            await this.db.updateUserStats(prediction.userId, match.guildId, status);
            
            const user = await this.client.users.fetch(prediction.userId);
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

        await channel.send({ embeds: [resultEmbed] });
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

    async updateUpcomingMatches() {
        // 更新即將開始的比賽
        console.log('更新比賽資料...');
    }

    start() {
        this.client.login(token);
    }
}

// 啟動機器人
const bot = new LOLPredictionBot();
bot.start();

// database.js
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

            // 預測記錄表
            this.db.run(`
                CREATE TABLE IF NOT EXISTS predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    match_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    prediction TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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

    async savePrediction(matchId, userId, guildId, prediction) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO predictions (match_id, user_id, guild_id, prediction) VALUES (?, ?, ?, ?)',
                [matchId, userId, guildId, prediction],
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
}

module.exports = Database;

// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class MatchScraper {
    constructor() {
        this.baseUrl = 'https://lolesports.com';
        this.leaguepediaUrl = 'https://lol.fandom.com';
    }

    async getTodayAndTomorrowMatches() {
        try {
            // 這裡需要根據實際的API或網頁結構來調整
            const response = await axios.get(`${this.baseUrl}/schedule`);
            const $ = cheerio.load(response.data);
            
            const matches = [];
            
            // 解析比賽資料的邏輯
            $('.match-item').each((index, element) => {
                const match = this.parseMatchElement($, element);
                if (this.isMatchToday(match.time) || this.isMatchTomorrow(match.time)) {
                    matches.push(match);
                }
            });
            
            return matches;
        } catch (error) {
            console.error('爬取比賽資料錯誤:', error);
            return [];
        }
    }

    parseMatchElement($, element) {
        const team1 = $(element).find('.team1').text().trim();
        const team2 = $(element).find('.team2').text().trim();
        const time = $(element).find('.match-time').text().trim();
        const tournament = $(element).find('.tournament').text().trim();
        const format = this.determineFormat($(element).find('.format').text().trim());
        const id = $(element).attr('data-match-id') || `${team1}-${team2}-${Date.now()}`;
        
        return {
            id,
            team1,
            team2,
            time,
            tournament,
            format
        };
    }

    determineFormat(formatText) {
        if (formatText.includes('BO5') || formatText.includes('Best of 5')) {
            return 'BO5';
        } else if (formatText.includes('BO3') || formatText.includes('Best of 3')) {
            return 'BO3';
        } else {
            return 'BO1';
        }
    }

    isMatchToday(matchTime) {
        const today = new Date();
        const matchDate = new Date(matchTime);
        return matchDate.toDateString() === today.toDateString();
    }

    isMatchTomorrow(matchTime) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const matchDate = new Date(matchTime);
        return matchDate.toDateString() === tomorrow.toDateString();
    }

    async getMatchResult(matchId) {
        try {
            // 檢查比賽是否結束並獲取結果
            const response = await axios.get(`${this.baseUrl}/match/${matchId}`);
            const $ = cheerio.load(response.data);
            
            const finished = $('.match-status').text().includes('Finished');
            
            if (!finished) {
                return null;
            }
            
            const winner = $('.winner').text().trim();
            const score = $('.final-score').text().trim();
            
            return {
                finished: true,
                winner,
                score
            };
        } catch (error) {
            console.error('獲取比賽結果錯誤:', error);
            return null;
        }
    }

    validatePrediction(prediction, format) {
        const regex = /^(\d+):(\d+)$/;
        const match = prediction.match(regex);
        
        if (!match) {
            return { valid: false, error: '格式錯誤！請使用 num:num 格式' };
        }
        
        const [, score1, score2] = match;
        const num1 = parseInt(score1);
        const num2 = parseInt(score2);
        
        if (num1 < 0 || num2 < 0) {
            return { valid: false, error: '分數不能為負數！' };
        }
        
        const maxWins = format === 'BO5' ? 3 : (format === 'BO3' ? 2 : 1);
        
        if (num1 > maxWins || num2 > maxWins) {
            return { valid: false, error: `${format} 最高只能到 ${maxWins} 勝！` };
        }
        
        if (num1 === maxWins && num2 === maxWins) {
            return { valid: false, error: '兩隊不能同時達到最高勝場！' };
        }
        
        if (num1 < maxWins && num2 < maxWins) {
            return { valid: false, error: '必須有一隊達到獲勝條件！' };
        }
        
        return { valid: true };
    }
}

module.exports = MatchScraper;