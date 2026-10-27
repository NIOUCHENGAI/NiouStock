export function addTrade(trades, trade) {
    return [trade, ...trades.filter(item => item.id !== trade.id)].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id).slice(0, 100)
}
export function updateCandle(candles, candle) {
    const last = candles.at(-1)
    if (last && candle.timestamp < last.timestamp) return candles
    if (last && candle.timestamp === last.timestamp) return [...candles.slice(0, -1), candle]
    return [...candles, candle].slice(-100)
}
