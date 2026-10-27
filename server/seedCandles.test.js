const { test } = require('node:test')
const assert = require('node:assert/strict')
const { generateSeedTrades } = require('./seedCandles')
const { aggregateCandles } = require('./candles')
const { isValidStockPrice, getDailyPriceLimits } = require('./index')

test('seed: deterministic historical trades obey ticks, limits and per-minute counts', () => {
    const now = Date.parse('2026-10-27T02:23:45Z')
    const trades = generateSeedTrades(now)
    assert.deepEqual(trades, generateSeedTrades(now))
    assert.equal(trades.length, 120)
    assert.equal(new Set(trades.map(t => t.id)).size, 120)
    const limits = getDailyPriceLimits({ referencePrice: 94.8 })
    for (const trade of trades) {
        assert.equal(trade.stockCode, 'YT001')
        assert.equal(trade.simulated, true)
        assert.ok(isValidStockPrice(trade.price))
        assert.ok(trade.price >= limits.limitDown && trade.price <= limits.limitUp)
        assert.ok(trade.price >= 96 && trade.price <= 103)
        assert.ok(Date.parse(trade.createdAt) < now && Date.parse(trade.createdAt) >= now - 61 * 60000)
        assert.ok(Number.isSafeInteger(trade.quantity) && trade.quantity > 0)
    }
    const candles = aggregateCandles(trades, '1m')
    assert.equal(candles.length, 60)
    assert.ok(candles.every(c => c.tradeCount >= 1 && c.tradeCount <= 3))
    assert.ok(candles.some(c => c.high > c.low && c.open !== c.close))
    assert.ok(new Set(candles.map(c => c.volume)).size > 10)
    assert.ok(new Set(candles.map(c => c.close)).size > 5)
    for (const [interval, low, high] of [['5m', 12, 13], ['15m', 4, 5], ['1h', 1, 2], ['1d', 1, 1]]) {
        const result = aggregateCandles(trades, interval)
        assert.ok(result.length >= low && result.length <= high)
        assert.equal(result.reduce((sum, c) => sum + c.tradeCount, 0), 120)
    }
})

test('seed: Taipei midnight splits daily history without future trades', () => {
    const now = Date.parse('2026-10-27T16:23:45Z')
    const trades = generateSeedTrades(now)
    assert.equal(aggregateCandles(trades, '1d').length, 2)
    assert.ok(trades.every(t => Date.parse(t.createdAt) < now))
})

for (const seeded of [false, true]) {
    test('startup HTTP: ' + (seeded ? 'seeded candles and unchanged accounts' : 'normal startup remains empty'), async () => {
        const { execFile } = require('node:child_process')
        const { promisify } = require('node:util')
        // Isolated process and ephemeral port: never touch the user server on 3000.
        const script = `
            const assert = require('node:assert/strict')
            const fs = require('node:fs')
            const Module = require('node:module')
            const filename = require.resolve('./server/index')
            const mod = new Module(filename, module)
            mod.filename = filename
            mod.paths = module.paths
            mod._compile(fs.readFileSync(filename, 'utf8').replace('const PORT = 3000', 'const PORT = 0'), filename)
            const server = mod.exports.startServer()
            server.on('listening', async () => {
                try {
                    const get = async path => {
                        const r = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path)
                        assert.equal(r.status, 200)
                        return r.json()
                    }
                    const trades = await get('/trades/YT001')
                    assert.equal(trades.length, ${seeded ? 120 : 0})
                    for (const interval of ['1m','5m','15m','1h','1d']) {
                        const candles = await get('/candles/YT001?interval=' + interval)
                        assert.equal(candles.reduce((n,c) => n + c.tradeCount, 0), ${seeded ? 120 : 0})
                    }
                    const accounts = await get('/accounts')
                    for (const a of accounts) {
                        assert.equal(a.cash, 1000000)
                        assert.equal(a.reservedCash, 0)
                        assert.equal(a.holdings[0].quantity, 2000)
                        assert.equal(a.holdings[0].reservedQuantity, 0)
                    }
                    assert.deepEqual(await get('/orders'), [])
                    assert.deepEqual(await get('/orderbook/YT001'), { stockCode: 'YT001', buys: [], sells: [] })
                    if (trades.length) assert.equal((await get('/stocks/YT001')).price, trades.at(-1).price)
                } catch (e) { console.error(e); process.exitCode = 1 }
                finally { server.close() }
            })
        `
        await promisify(execFile)(process.execPath, ['-e', script], {
            cwd: require('node:path').resolve(__dirname, '..'),
            env: { ...process.env, NODE_ENV: 'development', NIOUSTOCK_SEED_CANDLES: seeded ? '1' : '' }, timeout: 15000
        })
    })
}
