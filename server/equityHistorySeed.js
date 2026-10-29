// Pure display fixture: no server startup, matching or account mutations.
function generateEquityHistory(userId, valuation, now = Date.now()) {
    const endCents = Math.round(valuation.totalAssets * 100)
    const cashCents = Math.round(valuation.cash * 100)
    return Array.from({ length: 721 }, (_, i) => {
        const progress = i / 720
        const wave = (Math.sin(i / 29) * 650000 + Math.sin(i / 8) * 230000 + Math.sin(i / 71) * 450000) * Math.sin(Math.PI * progress)
        const totalCents = endCents + Math.round(-2300000 * (1 - progress) + wave)
        return { userId, timestamp: new Date(now - (720 - i) * 3600000).toISOString(),
            cash: cashCents / 100, holdingsValue: (totalCents - cashCents) / 100, totalAssets: totalCents / 100 }
    })
}
module.exports = { generateEquityHistory }
