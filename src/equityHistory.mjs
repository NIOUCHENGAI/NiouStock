export const EQUITY_RANGES = ['1D', '1W', '1M', 'ALL']
export function toEquityChartData(points) {
    // Multiple executions can share a millisecond; show the final valuation at that instant.
    const byTime = new Map()
    for (const point of points) {
        const time = Date.parse(point.timestamp) / 1000
        if (Number.isFinite(time) && Number.isFinite(point.totalAssets)) byTime.set(time, { time, value: point.totalAssets })
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time)
}
export const formatEquityTime = time => new Date(time * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
export const equityAmount = value => value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function formatEquityChange(summary) {
    const sign = value => value > 0 ? '+' : ''
    return `${sign(summary.change)}$${equityAmount(summary.change)} (${sign(summary.changePercent)}${equityAmount(summary.changePercent)}%)`
}
