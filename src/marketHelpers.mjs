export function filterStocks(stocks, category, search) {
    const query = search.trim().toLowerCase()
    return stocks.filter(stock => (category === '全部' || stock.category === category) &&
        (stock.code.toLowerCase().includes(query) || stock.name.toLowerCase().includes(query)))
}
export function updateMarket(stocks, stock) {
    return stocks.map(item => item.code === stock.code ? { ...item, ...stock } : item)
}
export function rankBy(items, key, direction, identity = 'code') {
    return [...items].sort((a, b) => direction * (a[key] - b[key]) ||
        (typeof a[identity] === 'number' ? a[identity] - b[identity] : a[identity].localeCompare(b[identity])))
}
export function marketRankings(stocks, limit = 5) {
    const sort = (key, direction) => rankBy(stocks, key, direction).slice(0, limit)
    return { gainers: sort('changePercent', -1), losers: sort('changePercent', 1), volumeLeaders: sort('volume', -1), turnoverLeaders: sort('turnover', -1) }
}
export function flowRankings(flows, limit = 5) {
    return { inflowLeaders: rankBy(flows, 'netFlow', -1).slice(0, limit),
        outflowLeaders: rankBy(flows, 'netFlow', 1).slice(0, limit),
        turnoverLeaders: rankBy(flows, 'turnover', -1).slice(0, limit) }
}
