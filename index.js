// index.js - V5.2 (只做 BTC/ETH + 区间修复 + 双核独立)

const axios = require('axios');
const WebSocket = require('ws');
const { Telegraf } = require('telegraf');

const config = require('./config');
const logger = require('./utils/logger');
const oracle = require('./services/oracle');

const bot = new Telegraf(config.TELEGRAM.BOT_TOKEN);
const marketMap = new Map();
const alertedCache = new Set(); 

logger.initLogFile(config.FILES.LOG_FILE);

// ==========================================
// 🧠 核心算法：提取所有价格边界
// ==========================================
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

// 🧠 核心算法：动态风控检查
function isCryptoSafe(currentPrice, targets, hoursLeft) {
    const { min, max } = targets;
    let gapPercent = 0;
    let isSafe = false;

    if (currentPrice > max) {
        gapPercent = (currentPrice - max) / currentPrice * 100;
        isSafe = checkGapSafety(gapPercent, hoursLeft);
    } else if (currentPrice < min) {
        gapPercent = (min - currentPrice) / currentPrice * 100;
        isSafe = checkGapSafety(gapPercent, hoursLeft);
    } else {
        gapPercent = 0;
        isSafe = false; 
    }

    return { isSafe, gapPercent, boundary: currentPrice > max ? max : min };
}

function checkGapSafety(gap, hours) {
    if (hours <= 1) return gap > 1.0;
    if (hours <= 6) return gap > 3.0;
    if (hours <= 12) return gap > 5.0;
    return gap > 8.0;
}
// ==========================================


async function scanTag(tag) {
    console.log(`[HTTP] 正在扫描板块: ${tag}...`);
    const strategy = config.STRATEGIES[tag];
    if (!strategy) return 0;

    try {
        const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=${tag}&limit=100&order=volume&ascending=false`;
        const response = await axios.get(url, { headers: config.HEADERS, timeout: 10000 });
        const events = response.data;
        const now = new Date();
        let addedCount = 0;

        for (const event of events) {
            const startDate = new Date(event.startDate);
            const endDate = new Date(event.endDate);
            let isTimeValid = false;

            if (tag === 'sports') {
                const hoursSinceStart = (now - startDate) / (1000 * 60 * 60);
                if (hoursSinceStart > 0 && hoursSinceStart < strategy.STARTED_WITHIN_HOURS) isTimeValid = true;
            } else if (tag === 'crypto') {
                const hoursUntilEnd = (endDate - now) / (1000 * 60 * 60);
                if (hoursUntilEnd > 0 && hoursUntilEnd < strategy.ENDING_WITHIN_HOURS) isTimeValid = true;
            }
            if (!isTimeValid) continue; 

            // ==========================================
            // 🛡️ 关键词过滤 (白名单模式)
            // ==========================================
            const title = event.title.toLowerCase();
            
            if (tag === 'sports') {
                // 体育黑名单：不看冠军/MVP
                if ((title.includes('champion') || title.includes('winner') || title.includes('mvp')) && !title.includes('vs')) continue;
            } 
            else if (tag === 'crypto') {
                // 🔥 Crypto 白名单：只看 BTC 和 ETH
                const isBTC = title.includes('bitcoin') || title.includes('btc');
                const isETH = title.includes('ethereum') || title.includes('eth');
                
                // 如果既不是 BTC 也不是 ETH，直接踢掉 (过滤 XRP, SOL, DOGE...)
                if (!isBTC && !isETH) continue;
            }
            // ==========================================

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
                            tag: tag,
                            title: event.title,
                            subTitle: subTitle,
                            outcome: outcomes[i],
                            slug: event.slug,
                            volume: market.volume,
                            startTime: startDate.toLocaleString(),
                            endTime: endDate.toLocaleString(),
                            endDateObj: endDate
                        });
                        addedCount++;
                    }
                } catch (e) {}
            }
        }
        return addedCount;
    } catch (error) {
        console.error(`❌ 扫描 ${tag} 失败:`, error.message);
        return 0;
    }
}

async function initMetadata() {
    const startTime = Date.now();
    const results = await Promise.all(config.ACTIVE_TAGS.map(tag => scanTag(tag)));
    const totalTokens = results.reduce((a, b) => a + b, 0);

    const duration = Date.now() - startTime;
    console.log(`[HTTP] ✅ 扫描完成! 耗时: ${duration}ms (监控总数: ${totalTokens})`);

    if (totalTokens === 0) {
        console.log(`⚠️ 无目标，1分钟后重试...`);
        setTimeout(initMetadata, 60000);
        return;
    }

    const allTokenIds = Array.from(marketMap.keys());
    startWebSocket(allTokenIds);
}

function startWebSocket(tokenIds) {
    const subscribeList = tokenIds.slice(0, 500); 
    console.log(`[WS] 启动监听...`);
    
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    ws.on('open', () => {
        console.log(`[WS] 连接成功! V5.2 稳健版 ✅`);
        const msg = { "type": "Subscribe", "assets_ids": subscribeList, "channel": "price" };
        ws.send(JSON.stringify(msg));
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

                const strategy = config.STRATEGIES[info.tag];
                
                if (price >= strategy.PRICE_MIN && price <= strategy.PRICE_MAX) {
                    
                    const cacheKey = `${item.asset_id}-${Math.floor(Date.now() / 60000)}`;
                    if (alertedCache.has(cacheKey)) continue;

                    let oracleMsg = "";
                    let isSafe = true;

                    if (info.tag === 'crypto') {
                        const title = info.title.toUpperCase();
                        let symbol = "";
                        if (title.includes("BITCOIN") || title.includes("BTC")) symbol = "BTC";
                        else if (title.includes("ETHEREUM") || title.includes("ETH")) symbol = "ETH";
                        // SOL 被删除了，只做最稳的

                        if (symbol) {
                            const prices = await oracle.getBinancePrices();
                            const currentPrice = prices[symbol];
                            const targets = parsePriceTargets(info.title, info.subTitle);
                            const hoursLeft = (info.endDateObj - Date.now()) / (1000 * 60 * 60);

                            if (currentPrice && targets) {
                                const riskCheck = isCryptoSafe(currentPrice, targets, hoursLeft, info.outcome);
                                isSafe = riskCheck.isSafe;
                                const gapPercent = riskCheck.gapPercent.toFixed(2);
                                
                                oracleMsg = `\n📊 **Binance**: $${currentPrice}`;
                                oracleMsg += `\n🚧 **边界**: $${targets.min} - $${targets.max}`;
                                oracleMsg += `\n📏 **距离**: ${gapPercent}% (离 ${riskCheck.boundary})`;
                                oracleMsg += `\n⏳ **剩**: ${hoursLeft.toFixed(1)}h`;
                                
                                if (!isSafe) {
                                    console.log(`[Risk] ⚠️ 拦截危险交易 (${info.title}): 距离 ${gapPercent}% 不足`);
                                    continue; 
                                }
                            }
                        }
                    }

                    logger.logTrade(config.FILES.LOG_FILE, info, price);

                    const profit = ((1 - price) * 100).toFixed(2);
                    const emoji = info.tag === 'crypto' ? '🪙' : '⚽️';
                    const targetInfo = info.subTitle ? ` [目标: ${info.subTitle}]` : "";
                    
                    const message = `
📝 **[模拟下单]** (${info.tag.toUpperCase()})
${emoji} **事件**: ${info.title}${targetInfo}
🎯 **下注**: ${info.outcome}
💰 **价格**: $${price.toFixed(2)}${oracleMsg}
💵 **模拟投入**: $100
📈 **预计获利**: $${profit}
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
        console.log('[WS] 断开，3秒后重连...');
        setTimeout(() => startWebSocket(subscribeList), 3000);
    });

    ws.on('error', (err) => console.error('[WS] 错误:', err.message));
}

initMetadata();
setInterval(() => {
    console.log('[System] 刷新全网列表...');
    initMetadata();
}, 30 * 60 * 1000);