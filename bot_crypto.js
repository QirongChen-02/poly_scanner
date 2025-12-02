// bot_crypto.js - Crypto 猎人专用 (含动态风控)

const axios = require('axios');
const WebSocket = require('ws');
const { Telegraf } = require('telegraf');

const config = require('./config');
const logger = require('./utils/logger');
const oracle = require('./services/oracle');

const bot = new Telegraf(config.TELEGRAM.BOT_TOKEN);
const marketMap = new Map();
const alertedCache = new Set();
const TAG = 'crypto'; // 固定只看 Crypto

logger.initLogFile(config.FILES.LOG_FILE);

// --- 复用之前的风控逻辑 ---
function parsePriceTargets(title, subTitle) {
    let text = subTitle || title;
    text = text.replace(/,/g, '').replace(/\$/g, '');
    const matches = text.match(/(\d+\.?\d*)/g);
    if (!matches || matches.length === 0) return null;
    const numbers = matches.map(n => parseFloat(n)).filter(n => !isNaN(n));
    numbers.sort((a, b) => a - b);
    if (numbers.length === 1) return { min: numbers[0], max: numbers[0] };
    const max = numbers[numbers.length - 1];
    const min = numbers[numbers.length - 2];
    if (min < 100 && max > 1000) return { min: max, max: max };
    return { min, max };
}

function isCryptoSafe(currentPrice, targets, hoursLeft) {
    const { min, max } = targets;
    let gapPercent = 0;
    
    if (currentPrice > max) gapPercent = (currentPrice - max) / currentPrice * 100;
    else if (currentPrice < min) gapPercent = (min - currentPrice) / currentPrice * 100;
    else return { isSafe: false, gapPercent: 0, boundary: "In Range" };

    let isSafe = false;
    if (hoursLeft <= 1) isSafe = gapPercent > 1.0;
    else if (hoursLeft <= 6) isSafe = gapPercent > 3.0;
    else if (hoursLeft <= 12) isSafe = gapPercent > 5.0;
    else isSafe = gapPercent > 8.0;

    return { isSafe, gapPercent, boundary: currentPrice > max ? max : min };
}

async function scanCrypto() {
    console.log(`[Crypto] 正在扫描预测...`);
    const strategy = config.STRATEGIES[TAG];

    try {
        const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=${TAG}&limit=100&order=volume&ascending=false`;
        const response = await axios.get(url, { headers: config.HEADERS, timeout: 10000 });
        const events = response.data;
        const now = new Date();
        let addedCount = 0;

        for (const event of events) {
            // 1. 时间过滤 (只看结束时间 - 倒计时)
            const endDate = new Date(event.endDate);
            const hoursUntilEnd = (endDate - now) / (1000 * 60 * 60);
            
            // 排除还有很久才结束的
            if (hoursUntilEnd <= 0 || hoursUntilEnd > strategy.ENDING_WITHIN_HOURS) continue;

            // 2. 关键词过滤 (白名单 + 黑名单)
            const title = event.title.toLowerCase();
            const isBTC = title.includes('bitcoin') || title.includes('btc');
            const isETH = title.includes('ethereum') || title.includes('eth');
            if (!isBTC && !isETH) continue; // 白名单
            if (title.includes('up or down')) continue; // 黑名单

            for (const market of event.markets) {
                if (market.volume < strategy.MIN_VOLUME) continue;
                if (!market.clobTokenIds) continue;

                try {
                    const outcomes = JSON.parse(market.outcomes);
                    const clobIds = JSON.parse(market.clobTokenIds);
                    const subTitle = market.groupItemTitle || ""; 

                    for (let i = 0; i < clobIds.length; i++) {
                        const tokenId = clobIds[i];
                        marketMap.set(tokenId, {
                            tag: TAG,
                            title: event.title,
                            subTitle: subTitle,
                            outcome: outcomes[i],
                            slug: event.slug,
                            volume: market.volume,
                            endTimeObj: endDate
                        });
                        addedCount++;
                    }
                } catch (e) {}
            }
        }
        
        console.log(`[Crypto] ✅ 扫描完成! 监控: ${addedCount} 个`);
        if (addedCount === 0) {
            setTimeout(scanCrypto, 60000);
            return;
        }
        startWebSocket(Array.from(marketMap.keys()));

    } catch (error) {
        console.error(`[Crypto] 扫描失败:`, error.message);
        setTimeout(scanCrypto, 10000);
    }
}

function startWebSocket(tokenIds) {
    const subscribeList = tokenIds.slice(0, 500); 
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    ws.on('open', () => {
        console.log(`[Crypto] WS 连接成功! 🪙`);
        ws.send(JSON.stringify({ "type": "Subscribe", "assets_ids": subscribeList, "channel": "price" }));
    });

    ws.on('message', async (data) => {
        try {
            const updates = JSON.parse(data);
            const items = Array.isArray(updates) ? updates : [updates];

            for (const item of items) {
                if (!item.asset_id || !item.price) continue;
                const price = parseFloat(item.price);
                const info = marketMap.get(item.asset_id);
                if (!info) continue;

                const strategy = config.STRATEGIES[TAG];
                if (price >= strategy.PRICE_MIN && price <= strategy.PRICE_MAX) {
                    
                    const cacheKey = `${item.asset_id}-${Math.floor(Date.now() / 60000)}`;
                    if (alertedCache.has(cacheKey)) continue;

                    // --- 预言机检查 ---
                    const title = info.title.toUpperCase();
                    let symbol = title.includes("BITCOIN") || title.includes("BTC") ? "BTC" : "ETH";
                    
                    const prices = await oracle.getBinancePrices();
                    const currentPrice = prices[symbol];
                    const targets = parsePriceTargets(info.title, info.subTitle);
                    const hoursLeft = (info.endTimeObj - Date.now()) / (1000 * 60 * 60);

                    // 目标价丢失保护
                    if (!targets) {
                         console.log(`[Risk] ⚠️ 拦截未知目标: ${info.title}`);
                         continue;
                    }

                    // 风控计算
                    let oracleMsg = "";
                    if (currentPrice) {
                        const risk = isCryptoSafe(currentPrice, targets, hoursLeft);
                        const gapPercent = risk.gapPercent.toFixed(2);
                        
                        oracleMsg = `\n📊 **Binance**: $${currentPrice}\n🚧 **边界**: $${targets.min}-${targets.max}\n📏 **距离**: ${gapPercent}% (剩 ${hoursLeft.toFixed(1)}h)`;

                        if (!risk.isSafe) {
                            console.log(`[Risk] ⚠️ 拦截危险交易: ${info.title} (距离 ${gapPercent}% 不足)`);
                            continue;
                        }
                    }
                    // ----------------

                    logger.logTrade(config.FILES.LOG_FILE, info, price);
                    
                    const profit = ((1 - price) * 100).toFixed(2);
                    const targetInfo = info.subTitle ? ` [目标: ${info.subTitle}]` : "";
                    const message = `
📝 **[模拟下单]** (CRYPTO)
🪙 **事件**: ${info.title}${targetInfo}
🎯 **下注**: ${info.outcome}
💰 **价格**: $${price.toFixed(2)}${oracleMsg}
💵 **模拟投入**: $100
📈 **预计获利**: $${profit}
👉 [查看链接](https://polymarket.com/event/${info.slug})
`;
                    console.log(message);
                    try { await bot.telegram.sendMessage(config.TELEGRAM.CHAT_ID, message); } catch (e) {}
                    alertedCache.add(cacheKey);
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => setTimeout(() => startWebSocket(subscribeList), 3000));
}

scanCrypto();
setInterval(() => { console.log('[Crypto] 刷新列表...'); scanCrypto(); }, 30 * 60 * 1000);