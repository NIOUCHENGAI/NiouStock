const { bucketStart } = require('./candles')
function marketStats(trades, code, now = Date.now()) {
    const day = bucketStart(now, '1d')
    let volume = 0, cents = 0, tradeCount = 0
    for (const trade of trades) {
        const time = Date.parse(trade.createdAt)
        if (trade.stockCode !== code || time < day || time >= day + 86400000) continue
        volume += trade.quantity
        cents += Math.round(trade.price * 100) * trade.quantity
        tradeCount++
    }
    return { volume, turnover: cents / 100, tradeCount }
}
function rankStocks(stocks, limit = 5) {
    const sorted = (key, direction) => [...stocks].sort((a, b) => direction * (a[key] - b[key]) || a.code.localeCompare(b.code)).slice(0, limit)
    return { gainers: sorted('changePercent', -1), losers: sorted('changePercent', 1), volumeLeaders: sorted('volume', -1), turnoverLeaders: sorted('turnover', -1) }
}
module.exports = { marketStats, rankStocks }
