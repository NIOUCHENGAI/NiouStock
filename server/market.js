const { bucketStart } = require('./candles')
const { periodStart } = require('../src/equityHistory.mjs')
const { marketRankings: rankStocks, flowRankings } = require('../src/marketHelpers.mjs')
function marketStats(trades, code, now = Date.now()) {
    const day = bucketStart(now, '1d')
    const { volume, turnover, tradeCount } = aggregateTrades(trades, code, day, day + 86400000)
    return { volume, turnover, tradeCount }
}
function aggregateTrades(trades, code, from, to) {
    let volume = 0, total = 0n, buy = 0n, sell = 0n, tradeCount = 0
    for (const trade of trades) {
        const time = Date.parse(trade.createdAt)
        if (trade.stockCode !== code || !Number.isFinite(time) || time < from || time >= to) continue
        const amount = BigInt(Math.round(trade.price * 100)) * BigInt(trade.quantity)
        volume += trade.quantity
        total += amount
        if (trade.aggressorSide === 'buy') buy += amount
        if (trade.aggressorSide === 'sell') sell += amount
        tradeCount++
    }
    return { volume, turnover: Number(total) / 100, tradeCount, buy, sell }
}
function stockFlow(trades, code, period = '1D', now = Date.now()) {
    const { volume, turnover, tradeCount, buy, sell } = aggregateTrades(trades, code, periodStart(period, now), now + 1)
    const classified = buy + sell
    return { stockCode: code, period, buyTurnover: Number(buy) / 100, sellTurnover: Number(sell) / 100,
        netFlow: Number(buy - sell) / 100, turnover, volume, tradeCount,
        buyRatio: classified ? Number((Number(buy) / Number(classified) * 100).toFixed(2)) : 0,
        sellRatio: classified ? Number((Number(sell) / Number(classified) * 100).toFixed(2)) : 0 }
}
function marketFlowRankings(trades, stocks, period = '1D', now = Date.now()) {
    periodStart(period, now)
    return { period, ...flowRankings(stocks.map(stock => ({ code: stock.code, name: stock.name, ...stockFlow(trades, stock.code, period, now) }))) }
}
module.exports = { marketStats, rankStocks, stockFlow, marketFlowRankings }
