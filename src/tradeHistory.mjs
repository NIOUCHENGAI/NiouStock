export const formatAmount = value => value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const formatPnl = value => (value > 0 ? '+' : '') + formatAmount(value)
export function historyQuery(filters, page, now = Date.now()) {
    const query = new URLSearchParams({ page: String(page), limit: '20' })
    if (filters.stockCode.trim()) query.set('stockCode', filters.stockCode.trim())
    if (filters.side) query.set('side', filters.side)
    if (filters.days) query.set('from', new Date(now - Number(filters.days) * 86400000).toISOString())
    return query.toString()
}
