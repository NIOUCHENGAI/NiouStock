// Fictional creators; YT001 preserves the original trading fixture prices.
const entries = [
    ['YT001', 'Creator Alpha', 'YouTube', 100, 94.8],
    ['YT002', 'Creator Nova', 'YouTube', 50, 50],
    ['YT003', 'Creator Orbit', 'YouTube', 80, 80],
    ['TW001', 'Streamer Echo', 'Twitch', 30, 30],
    ['TW002', 'Streamer Ember', 'Twitch', 60, 60],
    ['TW003', 'Streamer Grove', 'Twitch', 120, 120],
    ['VT001', 'VTuber Luna', 'VTuber', 40, 40],
    ['VT002', 'VTuber Comet', 'VTuber', 150, 150],
    ['VT003', 'VTuber Solstice', 'VTuber', 90, 90],
    ['KO001', 'Creator Willow', 'KOL', 25, 25],
    ['KO002', 'Creator Quartz', 'KOL', 200, 200],
    ['KO003', 'Creator Harbor', 'KOL', 70, 70]
]
function createStocks() {
    return entries.map(([code, name, category, price, previousClose]) => ({ code, name, category, price, previousClose, referencePrice: previousClose,
        change: Number((price - previousClose).toFixed(2)), changePercent: Number(((price - previousClose) / previousClose * 100).toFixed(2)) }))
}
module.exports = { createStocks }
