const money = value => Number(value < 0n ? -((-value + 5000n) / 10000n) : (value + 5000n) / 10000n) / 100
function boundary(value, end) {
    if (value === undefined) return end ? Infinity : -Infinity
    if (typeof value !== 'string') throw new Error('Invalid date')
    let text = value
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(value + 'T00:00:00Z')
        if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid date')
        text += 'T00:00:00+08:00'
        return Date.parse(text) + (end ? 86400000 : 0)
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) throw new Error('Use an ISO datetime with timezone')
    const day = text.slice(0, 10)
    if (new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) throw new Error('Invalid date')
    return Date.parse(text)
}
function tradeHistory(trades, stocks, userId, query = {}) {
    const integer = (key, fallback, max) => {
        const value = query[key] === undefined ? String(fallback) : query[key]
        if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new Error('Invalid ' + key)
        return Number(value)
    }
    const page = integer('page', 1, Number.MAX_SAFE_INTEGER), limit = integer('limit', 20, 100)
    if (query.side !== undefined && !['buy', 'sell'].includes(query.side)) throw new Error('Invalid side')
    if (query.stockCode !== undefined && typeof query.stockCode !== 'string') throw new Error('Invalid stockCode')
    const from = boundary(query.from, false), to = boundary(query.to, true)
    if (from >= to) throw new Error('Invalid date range')
    const filtered = trades.filter(t => !t.simulated && t.buyerUserId != null && t.sellerUserId != null &&
        (t.buyerUserId === userId || t.sellerUserId === userId) &&
        (!query.stockCode || t.stockCode === query.stockCode) &&
        (!query.side || (t.buyerUserId === userId ? 'buy' : 'sell') === query.side) &&
        Date.parse(t.createdAt) >= from && Date.parse(t.createdAt) < to)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)
    let buy = 0n, sell = 0n, pnl = 0n, totalBuys = 0, totalSells = 0
    for (const t of filtered) {
        const amount = BigInt(Math.round(t.price * 1000000)) * BigInt(t.quantity)
        if (t.buyerUserId === userId) { buy += amount; totalBuys++ }
        else { sell += amount; totalSells++; pnl += t.sellerRealizedPnlMicros }
    }
    const items = filtered.slice((page - 1) * limit, page * limit).map(t => {
        const side = t.buyerUserId === userId ? 'buy' : 'sell'
        const stock = stocks.find(s => s.code === t.stockCode)
        return { id: t.id, tradeId: t.id, userId, stockCode: t.stockCode, stockName: stock?.name || t.stockCode,
            category: stock?.category || '', side, price: t.price, quantity: t.quantity,
            amount: money(BigInt(Math.round(t.price * 1000000)) * BigInt(t.quantity)),
            realizedPnl: side === 'buy' ? 0 : t.sellerRealizedPnl,
            averageCostAtTrade: side === 'buy' ? t.buyerAverageCostAfter : t.sellerAverageCostAtTrade, createdAt: t.createdAt }
    })
    return { items, pagination: { page, limit, totalItems: filtered.length, totalPages: Math.ceil(filtered.length / limit) },
        summary: { totalBuys, totalSells, totalBuyAmount: money(buy), totalSellAmount: money(sell), realizedPnl: money(pnl) } }
}
module.exports = { tradeHistory, money }
