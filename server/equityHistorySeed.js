// Pure display fixture: no server startup, matching or account mutations.
function generateEquityHistory(userId, valuation, now = Date.now(), { profile = 0, days = 30 } = {}) {
    const endCents = Math.round(valuation.totalAssets * 100)
    const cashCents = Math.round(valuation.cash * 100)
    const hours = days * 24
    return Array.from({ length: hours + 1 }, (_, i) => {
        const progress = i / hours
        const wave = (Math.sin(i / 29) * 650000 + Math.sin(i / 8) * 230000 + Math.sin(i / 71) * 450000) * Math.sin(Math.PI * progress)
        const variation = profile ? Math.sin(Math.PI * progress) * (Math.sin(i / (5 + profile) + profile) * 1400000 + Math.cos(i / (23 + profile) + profile) * 2100000) : 0
        const trend = profile ? (profile % 2 ? 1 : -1) * (1000000 + profile * 310000) : -2300000
        const totalCents = endCents + Math.round(trend * (1 - progress) + wave + variation)
        return { userId, timestamp: new Date(now - (hours - i) * 3600000).toISOString(),
            cash: cashCents / 100, holdingsValue: (totalCents - cashCents) / 100, totalAssets: totalCents / 100 }
    })
}
module.exports = { generateEquityHistory }
