const { createHolding } = require('../src/portfolioMath.mjs')

function createDemoTraders() {
    return ['Alpha', 'Nova', 'Echo', 'Luna', 'Orbit', 'Ember', 'Comet', 'Willow'].map((name, i) => {
        const holding = createHolding(120 + i * 45, 90 + i * 0.5)
        holding.realizedPnlMicros = BigInt((i % 3 - 1) * (i + 1) * 750) * 1000000n
        return { id: i + 3, name: 'Trader ' + name, cash: 700000 + i * 95000,
            holdings: { YT001: holding, [i % 2 ? 'VT001' : 'YT002']: createHolding(20 + i * 10, i % 2 ? 38 : 48) } }
    })
}
module.exports = { createDemoTraders }
