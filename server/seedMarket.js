function generateMarketTrades(stocks, isValidPrice, getLimits, now = Date.now()) {
    const result = []
    const targets = [3, 8, -3, 1, -2, 2, 5, -1, 4, -6, 0, -4]
    const end = Math.floor(now / 60000) * 60000
    const start = end - 60 * 60000
    stocks.forEach((stock, index) => {
        const { limitDown, limitUp } = getLimits(stock)
        const legal = []
        for (let cents = Math.ceil(limitDown * 100); cents <= Math.round(limitUp * 100); cents++) {
            if (isValidPrice(cents / 100)) legal.push(cents / 100)
        }
        for (let minute = 0; minute < 60; minute++) {
            const count = index % 3 === 0 ? 3 + minute % 3 : 2 + (minute + index) % 3
            const progress = minute / 59
            const direction = targets[index % targets.length]
            const trend = direction * (0.35 + 0.65 * progress)
            const oscillation = Math.sin(minute / 5 + index) * 0.8 + Math.sin(minute / 2.3) * 0.35
            for (let tick = 0; tick < count; tick++) {
                const final = minute === 59 && tick === count - 1
                const target = stock.referencePrice * (1 + (final ? direction : trend + oscillation) / 100)
                const nearest = legal.reduce((best, price, i) => Math.abs(price - target) < Math.abs(legal[best] - target) ? i : best, 0)
                // Move across legal price levels, including across tick-size boundaries.
                const tickOffset = final ? 0 : [-1, 2, -2, 1, 0][tick]
                const price = legal[Math.max(0, Math.min(legal.length - 1, nearest + tickOffset))]
                result.push({ stockCode: stock.code, price,
                    quantity: (index + 1) * (10 + (minute * 3 + tick) % 4 * 5),
                    createdAt: new Date(start + minute * 60000 + (tick + 1) * 60000 / (count + 1)).toISOString(), simulated: true })
            }
        }
    })
    return result.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.stockCode.localeCompare(b.stockCode)).map((trade, i) => ({ id: i + 1, ...trade }))
}
module.exports = { generateMarketTrades }
if (require.main === module) {
    process.env.NIOUSTOCK_SEED_MARKET = '1'
    require('./index').startServer()
}
