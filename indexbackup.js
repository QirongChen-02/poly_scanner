// index.js - 猎人模式主程序 (模块化版)

const axios = require('axios');
const WebSocket = require('ws');
const { Telegraf } = require('telegraf');

// 引入我们可以拆分出去的模块
const config = require('./config');
const logger = require('./utils/logger');

// 初始化
const bot = new Telegraf(config.TELEGRAM.BOT_TOKEN);
const marketMap = new Map();
const alertedCache = new Set();

// 1. 初始化记账本
logger.initLogFile(config.FILES.LOG_FILE);

async function initMetadata() {
    const startTime = Date.now();
    console.log(`[HTTP] 🚀 开始全网扫描...`);
    console.log(`[HTTP] 正在扫描符合“猎人模式”的比赛...`);
    try {
        const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=${config.STRATEGY.TAG}&limit=500&order=volume&ascending=false`;
        
        // 使用 config 里的 HEADERS
        const response = await axios.get(url, { headers: config.HEADERS, timeout: 10000 });
        const events = response.data;
        const now = new Date();
        const tokensToSubscribe = []; 

        for (const event of events) {
            const startDate = new Date(event.startDate);
            const hoursDiff = (now - startDate) / (1000 * 60 * 60);
            
            if (hoursDiff > 24 || hoursDiff < -2) continue; 

            const title = event.title.toLowerCase();
            if ((title.includes('champion') || title.includes('winner') || title.includes('mvp') || title.includes('cup')) && !title.includes('vs')) {
                continue;
            }

            for (const market of event.markets) {
                // 使用 config 里的策略参数
                if (market.volume < config.STRATEGY.MIN_VOLUME) continue;
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
        console.log(`[HTTP] ✅ 扫描完成! 耗时: ${duration}ms (处理了 ${events.length} 个比赛, 监控 ${tokensToSubscribe.length} 个选项)`);

        if (tokensToSubscribe.length === 0) {
            console.log(`⚠️ 没有比赛，1分钟后重试...`);
            setTimeout(initMetadata, 60000);
            return;
        }

        startWebSocket(tokensToSubscribe);

    } catch (error) {
        console.error("❌ HTTP 初始化失败:", error.message);
        setTimeout(initMetadata, 10000);
    }
}

// 在 startWebSocket 函数外面定义一个计数器
let msgCount = 0;
function startWebSocket(tokenIds) {
    console.log(`[WS] 启动监听...`);
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    ws.on('open', () => {
        console.log(`[WS] 连接成功! 模拟交易记录器已就绪 ✅`);
        const msg = { "type": "Subscribe", "assets_ids": tokenIds, "channel": "price" };
        ws.send(JSON.stringify(msg));
    });

    
    ws.on('message', async (data) => {
        try {
            // 👇 新增：每收到 50 个价格包，打印一次“心跳”
            msgCount++;
            if (msgCount % 50 === 0) {
                // process.stdout.write 可以不换行打印，像进度条一样
                // 或者直接用 console.log
                console.log(`[WS] ⚡️ 正在极速监听中... (已处理 ${msgCount} 条价格更新)`);
            }

            const updates = JSON.parse(data);
            const items = Array.isArray(updates) ? updates : [updates];
            
            for (const item of items) {
                if (!item.asset_id || !item.price) continue;
                const price = parseFloat(item.price);

                // 使用 config 里的策略参数
                if (price >= config.STRATEGY.PRICE_MIN && price <= config.STRATEGY.PRICE_MAX) {
                    const info = marketMap.get(item.asset_id);
                    if (!info) continue;

                    const cacheKey = `${item.asset_id}-${Math.floor(Date.now() / 60000)}`;
                    if (alertedCache.has(cacheKey)) continue;

                    // 调用 logger 模块记录交易
                    logger.logTrade(config.FILES.LOG_FILE, info, price);

                    const message = `
📝 **[模拟下单成功]**
⚽️ **比赛**: ${info.title}
🎯 **下注**: ${info.outcome}
💰 **价格**: $${price.toFixed(2)}
💵 **模拟投入**: $100
📈 **预计获利**: $${((1 - price) * 100).toFixed(2)}
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
        console.log('[WS] 断开，3秒后重连...');
        setTimeout(() => startWebSocket(tokenIds), 3000);
    });

    ws.on('error', (err) => console.error('[WS] 错误:', err.message));
}

initMetadata();
setInterval(() => {
    console.log('[System] 刷新比赛列表...');
    initMetadata();
}, 30 * 60 * 1000);