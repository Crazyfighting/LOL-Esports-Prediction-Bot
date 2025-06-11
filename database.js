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
}

module.exports = Database; 