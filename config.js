// config.js - V4.0 分体式策略配置

module.exports = {
    // 👇 Telegram 信息
    TELEGRAM: {
        BOT_TOKEN: '8291799193:AAEDlrSqojIPCZ78EtoCLR2zGt1Mqz34D6A',
        CHAT_ID: '8259062849'
    },

    // 👇 策略总开关：你想跑哪些？
    ACTIVE_TAGS: ['sports', 'crypto'],

    // 👇 独立策略配置中心
    STRATEGIES: {
        // ⚽️ 体育策略：关注“正在进行”
        sports: {
            MIN_VOLUME: 5000,     
            PRICE_MIN: 0.93,      // 体育比较稳，门槛高一点
            PRICE_MAX: 0.98,
            // 时间逻辑：只看过去 X 小时内开始的比赛 (确保是 Live 或刚结束)
            STARTED_WITHIN_HOURS: 24 
        },

        // 🪙 Crypto策略：关注“即将到期”
        crypto: {
            MIN_VOLUME: 10000,    // 币圈流动性好，门槛可以调高
            PRICE_MIN: 0.10,      // 币圈波动大，稍微放宽一点
            PRICE_MAX: 0.98,
            // 时间逻辑：只看未来 X 小时内结束的预测 (末日轮盘)
            // 解决你的痛点：排除那些还有好几天才结束的
            ENDING_WITHIN_HOURS: 24 
        }
    },

    // 👇 系统文件配置
    FILES: {
        LOG_FILE: 'trades.csv'
    },
    HEADERS: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
    }
};