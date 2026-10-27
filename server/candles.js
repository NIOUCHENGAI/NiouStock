const intervals = Object.freeze({ '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '1d': 86400000 })
function bucketStart(time, interval) {
    const duration = intervals[interval]
    if (!duration) throw new Error('Invalid interval')
    const offset = interval === '1d' ? 8 * 3600000 : 0
    return Math.floor((new Date(time).getTime() + offset) / duration) * duration - offset
}
function aggregateCandles(trades, interval) {
    if (!Object.hasOwn(intervals, interval)) throw new Error('Invalid interval')
    const buckets = new Map()
    const sorted = [...trades].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id)
    for (const trade of sorted) {
        const timestamp = bucketStart(trade.createdAt, interval)
        let candle = buckets.get(timestamp)
        if (!candle) {
            candle = { timestamp, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: 0, tradeCount: 0 }
            buckets.set(timestamp, candle)
        }
        candle.high = Math.max(candle.high, trade.price)
        candle.low = Math.min(candle.low, trade.price)
        candle.close = trade.price
        candle.volume += trade.quantity
        candle.tradeCount++
    }
    return [...buckets.values()]
}
module.exports = { intervals, bucketStart, aggregateCandles }
