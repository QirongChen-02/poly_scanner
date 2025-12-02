// utils/logger.js
const fs = require('fs');

// 初始化记账本
function initLogFile(filePath) {
    if (!fs.existsSync(filePath)) {
        const header = '时间,比赛名称,下注选项,当前价格,池子大小,模拟投入($),预计利润($),链接\n';
        fs.writeFileSync(filePath, header);
        console.log(`[System] 🆕 已创建记账本: ${filePath}`);
    }
}

// 记录一笔交易
function logTrade(filePath, info, price) {
    const now = new Date().toLocaleString();
    const betSize = 100; // 模拟每单 $100
    const profit = ((1 - price) * betSize).toFixed(2);
    
    // CSV 格式化
    const row = `${now},"${info.title}","${info.outcome}",${price},${info.volume},${betSize},${profit},https://polymarket.com/event/${info.slug}\n`;
    
    fs.appendFileSync(filePath, row);
    console.log(`[PaperTrade] 📝 已记录交易: ${info.outcome} @ $${price}`);
}

// 导出函数给主程序用
module.exports = { initLogFile, logTrade };