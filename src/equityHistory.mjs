import { formatAmount } from './tradeHistory.mjs'
export { formatAmount as equityAmount } from './tradeHistory.mjs'

const PERIOD_MS = { '1D': 86400000, '1W': 7 * 86400000, '1M': 30 * 86400000, ALL: Infinity }
export const EQUITY_RANGES = Object.keys(PERIOD_MS)
export function periodStart(period, now, label = 'period') {
    if (typeof period !== 'string' || !Object.hasOwn(PERIOD_MS, period)) throw new Error('Invalid ' + label)
    return now - PERIOD_MS[period]
}
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
export function formatEquityChange(summary) {
    const sign = value => value > 0 ? '+' : ''
    return `${sign(summary.change)}$${formatAmount(summary.change)} (${sign(summary.changePercent)}${formatAmount(summary.changePercent)}%)`
}
