const { Client, GatewayIntentBits, Collection, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { token } = require('./config.json');
const Database = require('./database.js');
const MatchScraper = require('./scraper.js');
const cron = require('node-cron');
const path = require('path');

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

        // 移除 'prediction_' 前綴，保留完整的比賽 ID
        const matchId = interaction.customId.replace('prediction_', '');
        console.log('Modal 提交，完整 customId:', interaction.customId);
        console.log('解析後的比賽ID:', matchId);
        console.log('當前活躍比賽:', Array.from(this.activeMatches.keys()));
        
        const match = this.activeMatches.get(matchId);
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

            // 清空之前的活躍比賽
            this.activeMatches.clear();
            console.log('已清空活躍比賽列表');

            for (const match of matches) {
                console.log('處理比賽:', match);
                const { embed, files } = await this.createMatchEmbed(match);
                const button = this.createPredictButton(match.id);
                
                await interaction.followUp({
                    embeds: [embed],
                    components: [button],
                    files: files
                });
                
                // 確保比賽資料被正確加入
                this.activeMatches.set(match.id, {
                    ...match,
                    guildId: interaction.guild.id,
                    channelId: interaction.channel.id
                });
                console.log('已加入活躍比賽:', match.id);
            }

            console.log('當前活躍比賽列表:', Array.from(this.activeMatches.keys()));
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

    async createMatchEmbed(match) {
        const matchDate = new Date(match.time);
        const formattedDate = matchDate.toISOString().split('T')[0]; // Gets YYYY-MM-DD
        const formattedTime = matchDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .addFields(
                { name: '日期', value: formattedDate, inline: true },
                { name: '時間 (UTC)', value: formattedTime, inline: true },
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
        // 移除 'predict_' 前綴，保留完整的比賽 ID
        const matchId = interaction.customId.replace('predict_', '');
        console.log('預測按鈕點擊，完整 customId:', interaction.customId);
        console.log('解析後的比賽ID:', matchId);
        console.log('當前活躍比賽:', Array.from(this.activeMatches.keys()));
        
        const match = this.activeMatches.get(matchId);
        console.log('找到的比賽資料:', match);
        
        if (!match) {
            console.log('找不到比賽資料，可能原因：');
            console.log('1. 比賽已過期');
            console.log('2. 比賽ID不匹配');
            console.log('3. activeMatches 未正確更新');
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

    async checkMatchResults() {
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

        const matchDate = new Date(match.time);
        const formattedDate = matchDate.toISOString().split('T')[0];
        const formattedTime = matchDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

        const resultEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setDescription(`${result.winner} 獲勝！比分: ${result.score}`)
            .addFields(
                { name: '比賽日期', value: formattedDate, inline: true },
                { name: '比賽時間 (UTC)', value: formattedTime, inline: true },
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

        await channel.send({ embeds: [resultEmbed], files: files });
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