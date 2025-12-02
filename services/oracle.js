// services/oracle.js - 你的币价预言机
const axios = require('axios');

// 缓存价格，防止频繁请求币安被封
let priceCache = {
    BTC: null,
    ETH: null,
    SOL: null,
    lastUpdate: 0
};

async function getBinancePrices() {
    const now = Date.now();
    // 如果缓存小于 10 秒，直接返回缓存 (节约资源)
    if (now - priceCache.lastUpdate < 10000 && priceCache.BTC) {
        return priceCache;
    }

    try {
        // 一次性获取主力代币价格
        const url = 'https://api.binance.com/api/v3/ticker/price';
        const response = await axios.get(url);
        const data = response.data;

        // 更新缓存
        const btc = data.find(i => i.symbol === 'BTCUSDT');
        const eth = data.find(i => i.symbol === 'ETHUSDT');
        const sol = data.find(i => i.symbol === 'SOLUSDT');

        if (btc) priceCache.BTC = parseFloat(btc.price);
        if (eth) priceCache.ETH = parseFloat(eth.price);
        if (sol) priceCache.SOL = parseFloat(sol.price);
        
        priceCache.lastUpdate = now;
        // console.log(`[Oracle] 币价更新: BTC $${priceCache.BTC} | ETH $${priceCache.ETH}`);
        
        return priceCache;
    } catch (e) {
        console.error("❌ 无法连接币安 API:", e.message);
        return priceCache; // 返回旧数据保命
    }
}

module.exports = { getBinancePrices };