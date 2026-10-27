// Synthetic chart fixtures only: these are not settled orders or account transactions.
function generateSeedTrades(now = Date.now()) {
    const end = Math.floor(now / 60000) * 60000
    const result = []
    for (let minute = 0; minute < 60; minute++) {
        const count = 1 + minute % 3
        for (let tick = 0; tick < count; tick++) {
            // Fixed smooth wave, quantized to 0.50: legal throughout 96..103.
            const wave = 99.5 + 2.5 * Math.sin(minute / 6) + 0.75 * Math.sin(minute / 2 + tick * 1.7)
            const price = Math.max(96, Math.min(103, Math.round(wave * 2) / 2))
            result.push({
                id: result.length + 1,
                stockCode: 'YT001',
                price,
                quantity: 10 * (1 + (minute * 7 + tick * 3) % 20),
                createdAt: new Date(end - (60 - minute) * 60000 + (tick + 1) * 15000).toISOString(),
                simulated: true
            })
        }
    }
    return result
}
module.exports = { generateSeedTrades }

// Start a new local server; never attempt to mutate a different process's memory.
if (require.main === module) {
    process.env.NIOUSTOCK_SEED_CANDLES = '1'
    require('./index').startServer()
}
