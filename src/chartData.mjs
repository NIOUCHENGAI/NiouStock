export function toChartCandle(candle) {
    return { time: Math.floor(candle.timestamp / 1000), open: candle.open,
        high: candle.high, low: candle.low, close: candle.close }
}
export function chartChange(previous, next) {
    if (previous.length && next.length >= previous.length - 1 && next.length &&
        next.at(-1).timestamp >= previous.at(-1).timestamp) {
        const boundary = previous.at(-1).timestamp
        const oldHistory = previous.filter(c => c.timestamp < boundary)
        const newHistory = next.filter(c => c.timestamp < boundary)
        // A capped history may have dropped its oldest candle. Do not reset the viewport.
        const overlap = oldHistory.filter(c => c.timestamp >= (next[0]?.timestamp ?? Infinity))
        if (JSON.stringify(overlap) === JSON.stringify(newHistory)) return 'update'
    }
    return 'replace'
}
export function formatChartTime(time, interval, axis = false) {
    const date = typeof time === 'number' ? new Date(time * 1000)
        : typeof time === 'string' ? new Date(time)
        : new Date(Date.UTC(time.year, time.month - 1, time.day))
    return new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei', hour12: false,
        ...(interval === '1d' || !axis ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
        ...(interval !== '1d' ? { hour: '2-digit', minute: '2-digit' } : {})
    }).format(date)
}

// In sparse datasets, candle slots plus right-side blank slots fill the plot.
// Dense datasets instead show the latest bars with a small trailing margin.
export function initialRightOffset(plotWidth, candleCount, barSpacing = 9, trailingSlots = 3) {
    const capacity = Math.max(0, plotWidth) / barSpacing
    return Math.max(trailingSlots, capacity - candleCount)
}
