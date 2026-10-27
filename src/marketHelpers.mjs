export function filterStocks(stocks, category, search) {
    const query = search.trim().toLowerCase()
    return stocks.filter(stock => (category === '全部' || stock.category === category) &&
        (stock.code.toLowerCase().includes(query) || stock.name.toLowerCase().includes(query)))
}
export function updateMarket(stocks, stock) {
    return stocks.map(item => item.code === stock.code ? { ...item, ...stock } : item)
}
export function marketRankings(stocks) {
    const sort = (key, direction) => [...stocks].sort((a, b) => direction * (a[key] - b[key]) || a.code.localeCompare(b.code)).slice(0, 5)
    return { gainers: sort('changePercent', -1), losers: sort('changePercent', 1), volumeLeaders: sort('volume', -1), turnoverLeaders: sort('turnover', -1) }
}
