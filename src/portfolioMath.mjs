// Cost prices use integer micro-currency (six decimal places). BigInt intermediates
// prevent floating-point drift; public monetary amounts round to cents, half away from zero.
const SCALE = 1000000n
const micro = value => BigInt(Math.round(value * 1000000))
const divide = (value, divisor) => value < 0n ? -((-value + divisor / 2n) / divisor) : (value + divisor / 2n) / divisor
const money = value => Number(divide(value, 10000n)) / 100
const percentage = (amount, base) => base === 0 ? 0 : Number((amount / base * 100).toFixed(2))
export function createHolding(quantity = 0, averageCost = 0) {
    return { quantity, averageCostMicros: quantity ? micro(averageCost) : 0n, realizedPnlMicros: 0n }
}
export function buyHolding(holding, quantity, price) {
    const total = holding.quantity + quantity
    holding.averageCostMicros = divide(holding.averageCostMicros * BigInt(holding.quantity) + micro(price) * BigInt(quantity), BigInt(total))
    holding.quantity = total
}
export function sellHolding(holding, quantity, price) {
    holding.realizedPnlMicros += (micro(price) - holding.averageCostMicros) * BigInt(quantity)
    holding.quantity -= quantity
    if (!holding.quantity) holding.averageCostMicros = 0n
}
export function valuePosition(position, stock) {
    const quantity = position.quantity
    const cost = micro(position.averageCost) * BigInt(quantity)
    const market = micro(stock.price) * BigInt(quantity)
    const daily = (micro(stock.price) - micro(stock.previousClose)) * BigInt(quantity)
    return { ...position, name: stock.name, category: stock.category, previousClose: stock.previousClose,
        price: stock.price, currentPrice: stock.price,
        costBasis: money(cost), marketValue: money(market), unrealizedPnl: money(market - cost),
        unrealizedPnlPercent: percentage(Number(market - cost), Number(cost)),
        todayPnl: money(daily), todayPnlPercent: quantity ? percentage(stock.price - stock.previousClose, stock.previousClose) : 0 }
}
export function summarizePositions(cash, reservedCash, positions) {
    const sum = key => Number(positions.reduce((total, p) => total + BigInt(Math.round(p[key] * 100)), 0n)) / 100
    const holdingsValue = sum('marketValue')
    return { cash, reservedCash, availableCash: (Math.round(cash * 100) - Math.round(reservedCash * 100)) / 100,
        holdingsValue, costBasis: sum('costBasis'), unrealizedPnl: sum('unrealizedPnl'), realizedPnl: sum('realizedPnl'),
        todayPnl: sum('todayPnl'), totalAssets: (Math.round(cash * 100) + Math.round(holdingsValue * 100)) / 100 }
}
export function publicHolding(holding) {
    return { quantity: holding.quantity, averageCost: Number(holding.averageCostMicros) / Number(SCALE), realizedPnl: money(holding.realizedPnlMicros) }
}
export function revaluePortfolio(portfolio, stock) {
    const revalue = p => p.stockCode === stock.code ? valuePosition(p, stock) : p
    const positions = portfolio.positions.map(revalue)
    // Keep realized PnL from closed positions in the REST summary.
    const totals = summarizePositions(portfolio.summary.cash, portfolio.summary.reservedCash, positions)
    return { ...portfolio, positions, summary: { ...totals, realizedPnl: portfolio.summary.realizedPnl } }
}
