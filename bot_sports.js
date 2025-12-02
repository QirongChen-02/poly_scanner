// bot_sports.js - 体育猎人专用版 (解耦合架构)

const axios = require('axios');
const WebSocket = require('ws');
const { Telegraf } = require('telegraf');

// 引入公共模块
const config = require('./config');
const logger = require('./utils/logger');

// 初始化
const bot = new Telegraf(config.TELEGRAM.BOT_TOKEN);
const marketMap = new Map();
const alertedCache = new Set();

// 固定标签：只看体育
const TAG = 'sports';

// 1. 初始化记账本
logger.initLogFile(config.FILES.LOG_FILE);

async function scanSports() {
    const startTime = Date.now();
    console.log(`[Sports] 🚀 开始扫描比赛...`);
    
    // 获取体育专属配置 (兼容性处理：如果 config 里是新结构 STRATEGIES，则取 sports，否则取旧结构)
    const strategy = config.STRATEGIES ? config.STRATEGIES[TAG] : config.STRATEGY;

    try {
        const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=${TAG}&limit=500&order=volume&ascending=false`;
        
        const response = await axios.get(url, { headers: config.HEADERS, timeout: 10000 });
        const events = response.data;
        const now = new Date();
        const tokensToSubscribe = []; 

        for (const event of events) {
            // --- 1. 时间过滤 (完全保留你的逻辑) ---
            const startDate = new Date(event.startDate);
            // 计算开始到现在过了多久 (负数代表还有多久开始)
            const hoursDiff = (now - startDate) / (1000 * 60 * 60);
            
            // 逻辑：踢掉 "开始超过24小时的" 和 "未来2小时后才开始的"
            // 保留：正在进行的 + 马上要开始的 (赛前埋伏)
            if (hoursDiff > 24 || hoursDiff < -2) continue; 

            // --- 2. 关键词过滤 (完全保留你的逻辑) ---
            const title = event.title.toLowerCase();
            if ((title.includes('champion') || title.includes('winner') || title.includes('mvp') || title.includes('cup')) && !title.includes('vs')) {
                continue;
            }

            for (const market of event.markets) {
                // 使用策略配置的成交量
                if (market.volume < strategy.MIN_VOLUME) continue;
                if (!market.clobTokenIds) continue;

                try {
                    const outcomes = JSON.parse(market.outcomes);
                    const clobIds = JSON.parse(market.clobTokenIds);

                    for (let i = 0; i < clobIds.length; i++) {
                        const tokenId = clobIds[i];
                        marketMap.set(tokenId, {
                            title: event.title,
                            outcome: outcomes[i],
                            slug: event.slug,
                            volume: market.volume,
                            startTime: startDate.toLocaleString()
                        });
                        tokensToSubscribe.push(tokenId);
                    }
                } catch (e) {}
            }
        }
        
        const duration = Date.now() - startTime;
        console.log(`[Sports] ✅ 扫描完成! 耗时: ${duration}ms (处理了 ${events.length} 个事件, 监控 ${tokensToSubscribe.length} 个选项)`);

        if (tokensToSubscribe.length === 0) {
            console.log(`[Sports] ⚠️ 暂无符合条件的比赛，1分钟后重试...`);
            setTimeout(scanSports, 60000);
            return;
        }

        // 启动专属 WebSocket
        startWebSocket(tokensToSubscribe);

    } catch (error) {
        console.error("[Sports] ❌ HTTP 初始化失败:", error.message);
        setTimeout(scanSports, 10000);
    }
}

// WS 计数器
let msgCount = 0;

function startWebSocket(tokenIds) {
    console.log(`[Sports] 启动 WS 监听...`);
    // 每次订阅前只取前 500 个 (防止超出限制)
    const subscribeList = tokenIds.slice(0, 500); 
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    ws.on('open', () => {
        console.log(`[Sports] WS 连接成功! ⚽️ 猎人已就绪`);
        const msg = { "type": "Subscribe", "assets_ids": subscribeList, "channel": "price" };
        ws.send(JSON.stringify(msg));
    });

    ws.on('message', async (data) => {
        try {
            // 心跳日志 (如果你想看心跳，把下面注释打开)
            /*
            msgCount++;
            if (msgCount % 50 === 0) {
                console.log(`[Sports] ⚡️ 正在监听... (处理 ${msgCount} 条)`);
            }
            */

            const updates = JSON.parse(data);
            const items = Array.isArray(updates) ? updates : [updates];
            const strategy = config.STRATEGIES ? config.STRATEGIES[TAG] : config.STRATEGY;

            for (const item of items) {
                if (!item.asset_id || !item.price) continue;
                const price = parseFloat(item.price);

                // --- 核心价格过滤 ---
                if (price >= strategy.PRICE_MIN && price <= strategy.PRICE_MAX) {
                    const info = marketMap.get(item.asset_id);
                    if (!info) continue;

                    const cacheKey = `${item.asset_id}-${Math.floor(Date.now() / 60000)}`;
                    if (alertedCache.has(cacheKey)) continue;

                    // 1. 记账
                    logger.logTrade(config.FILES.LOG_FILE, info, price);

                    // 2. 报警
                    const message = `
📝 **[模拟下单]** (SPORTS)
⚽️ **比赛**: ${info.title}
🎯 **下注**: ${info.outcome}
💰 **价格**: $${price.toFixed(2)}
💵 **模拟投入**: $100
📈 **预计获利**: $${((1 - price) * 100).toFixed(2)}
👉 [查看链接](https://polymarket.com/event/${info.slug})
`;
                    console.log(message);
                    try {
                        await bot.telegram.sendMessage(config.TELEGRAM.CHAT_ID, message);
                    } catch (e) {}
                    
                    alertedCache.add(cacheKey);
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        // console.log('[Sports] WS断开，3秒后重连...');
        setTimeout(() => startWebSocket(subscribeList), 3000);
    });

    ws.on('error', (err) => console.error('[Sports] WS错误:', err.message));
}

// 启动
scanSports();

// 定时刷新 (30分钟)
setInterval(() => {
    console.log('[Sports] 刷新比赛列表...');
    scanSports();
}, 30 * 60 * 1000);