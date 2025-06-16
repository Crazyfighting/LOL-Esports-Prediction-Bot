const { Pool } = require('pg');

class Database {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        this.init();
    }

    async init() {
        try {
            // 使用者統計表
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS user_stats (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    perfect INTEGER DEFAULT 0,
                    winner INTEGER DEFAULT 0,
                    failed INTEGER DEFAULT 0,
                    UNIQUE(user_id, guild_id)
                )
            `);

            // 預測記錄表
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS predictions (
                    id SERIAL PRIMARY KEY,
                    match_id TEXT NOT NULL,
                    unique_id TEXT,
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    prediction TEXT NOT NULL,
                    match_date TEXT,
                    team1 TEXT,
                    team2 TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 廣播頻道設定表
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS iconfig (
                    guild_id TEXT PRIMARY KEY,
                    broadcast_channel_id TEXT
                )
            `);

            // 廣播過的比賽記錄表
            await this.pool.query(`
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
        } catch (error) {
            console.error('初始化資料庫時發生錯誤:', error);
            throw error;
        }
    }

    async getUserStats(userId, guildId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM user_stats WHERE user_id = $1 AND guild_id = $2',
                [userId, guildId]
            );
            return result.rows[0] || { perfect: 0, winner: 0, failed: 0 };
        } catch (error) {
            console.error('獲取使用者統計時發生錯誤:', error);
            throw error;
        }
    }

    async updateUserStats(userId, guildId, status) {
        try {
            const stats = await this.getUserStats(userId, guildId);
            const newStats = {
                perfect: stats.perfect + (status === 'perfect' ? 1 : 0),
                winner: stats.winner + (status === 'winner' ? 1 : 0),
                failed: stats.failed + (status === 'failed' ? 1 : 0)
            };

            await this.pool.query(
                `INSERT INTO user_stats (user_id, guild_id, perfect, winner, failed)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (user_id, guild_id)
                 DO UPDATE SET perfect = $3, winner = $4, failed = $5`,
                [userId, guildId, newStats.perfect, newStats.winner, newStats.failed]
            );
        } catch (error) {
            console.error('更新使用者統計時發生錯誤:', error);
            throw error;
        }
    }

    async savePrediction(matchId, userId, guildId, prediction, matchDate = null, team1 = null, team2 = null, uniqueId = null) {
        try {
            await this.pool.query(
                'INSERT INTO predictions (match_id, unique_id, user_id, guild_id, prediction, match_date, team1, team2) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [matchId, uniqueId, userId, guildId, prediction, matchDate, team1, team2]
            );
        } catch (error) {
            console.error('保存預測時發生錯誤:', error);
            throw error;
        }
    }

    async getUserPredictionForMatch(userId, guildId, matchId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM predictions WHERE user_id = $1 AND guild_id = $2 AND match_id = $3',
                [userId, guildId, matchId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('獲取使用者預測時發生錯誤:', error);
            throw error;
        }
    }

    async getMatchPredictions(matchId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM predictions WHERE match_id = $1',
                [matchId]
            );
            return result.rows;
        } catch (error) {
            console.error('獲取比賽預測時發生錯誤:', error);
            throw error;
        }
    }

    async getGuildLeaderboard(guildId) {
        try {
            const result = await this.pool.query(
                `SELECT user_id, perfect, winner, failed, 
                        (perfect + winner) as correct_predictions,
                        (perfect + winner + failed) as total_predictions
                 FROM user_stats 
                 WHERE guild_id = $1 AND (perfect + winner + failed) > 0
                 ORDER BY perfect DESC, winner DESC, total_predictions DESC
                 LIMIT 10`,
                [guildId]
            );
            return result.rows;
        } catch (error) {
            console.error('獲取排行榜時發生錯誤:', error);
            throw error;
        }
    }

    async getUserPredictions(userId, guildId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM predictions WHERE user_id = $1 AND guild_id = $2',
                [userId, guildId]
            );
            return result.rows;
        } catch (error) {
            console.error('獲取使用者預測時發生錯誤:', error);
            throw error;
        }
    }

    async setBroadcastChannel(guildId, channelId) {
        try {
            await this.pool.query(
                'INSERT INTO iconfig (guild_id, broadcast_channel_id) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET broadcast_channel_id = $2',
                [guildId, channelId]
            );
        } catch (error) {
            console.error('設定廣播頻道時發生錯誤:', error);
            throw error;
        }
    }

    async getBroadcastChannel(guildId) {
        try {
            const result = await this.pool.query(
                'SELECT broadcast_channel_id FROM iconfig WHERE guild_id = $1',
                [guildId]
            );
            return result.rows[0]?.broadcast_channel_id;
        } catch (error) {
            console.error('獲取廣播頻道時發生錯誤:', error);
            throw error;
        }
    }

    async getAllGuildsWithBroadcastChannel() {
        try {
            const result = await this.pool.query(
                'SELECT guild_id, broadcast_channel_id FROM iconfig WHERE broadcast_channel_id IS NOT NULL'
            );
            return result.rows;
        } catch (error) {
            console.error('獲取所有廣播頻道時發生錯誤:', error);
            throw error;
        }
    }

    async getBroadcastedMatches(guildId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM broadcasted_matches WHERE guild_id = $1',
                [guildId]
            );
            return result.rows.map(row => ({
                id: row.match_id,
                data: JSON.parse(row.match_data),
                time: row.match_time,
                team1: row.team1,
                team2: row.team2,
                format: row.format,
                tournament: row.tournament
            }));
        } catch (error) {
            console.error('獲取廣播比賽時發生錯誤:', error);
            throw error;
        }
    }

    async getSingleBroadcastedMatch(guildId, matchId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM broadcasted_matches WHERE guild_id = $1 AND match_id = $2',
                [guildId, matchId]
            );
            const row = result.rows[0];
            return row ? {
                id: row.match_id,
                data: JSON.parse(row.match_data),
                time: row.match_time,
                team1: row.team1,
                team2: row.team2,
                format: row.format,
                tournament: row.tournament
            } : null;
        } catch (error) {
            console.error('獲取單一廣播比賽時發生錯誤:', error);
            throw error;
        }
    }

    async addBroadcastedMatch(guildId, matchId, matchData) {
        try {
            await this.pool.query(
                'INSERT INTO broadcasted_matches (guild_id, match_id, match_data, match_time, team1, team2, format, tournament) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (guild_id, match_id) DO UPDATE SET match_data = $3, match_time = $4, team1 = $5, team2 = $6, format = $7, tournament = $8',
                [
                    guildId,
                    matchId,
                    JSON.stringify(matchData),
                    matchData.time,
                    matchData.team1,
                    matchData.team2,
                    matchData.format,
                    matchData.tournament
                ]
            );
        } catch (error) {
            console.error('添加廣播比賽時發生錯誤:', error);
            throw error;
        }
    }

    async removeBroadcastedMatch(guildId, matchId) {
        try {
            await this.pool.query(
                'DELETE FROM broadcasted_matches WHERE guild_id = $1 AND match_id = $2',
                [guildId, matchId]
            );
        } catch (error) {
            console.error('移除廣播比賽時發生錯誤:', error);
            throw error;
        }
    }

    async updatePrediction(matchId, userId, guildId, prediction) {
        try {
            await this.pool.query(
                `UPDATE predictions 
                 SET prediction = $1, 
                     timestamp = CURRENT_TIMESTAMP
                 WHERE match_id = $2 
                 AND user_id = $3 
                 AND guild_id = $4`,
                [prediction, matchId, userId, guildId]
            );
            console.log(`已更新預測: matchId=${matchId}, userId=${userId}, guildId=${guildId}, prediction=${prediction}`);
        } catch (error) {
            console.error('更新預測時發生錯誤:', error);
            throw error;
        }
    }
}

module.exports = Database; 