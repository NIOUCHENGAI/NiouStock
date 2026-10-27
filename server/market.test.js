const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { WebSocket } = require('ws')
const { marketStats, rankStocks } = require('./market')
const { createStocks } = require('./stockFixtures')
const { generateMarketTrades } = require('./seedMarket')
const now = Date.parse('2026-10-28T04:00:00Z')
const fixture = [
    { code: 'A', changePercent: 5, volume: 10, turnover: 100 },
    { code: 'B', changePercent: -3, volume: 30, turnover: 60 },
    { code: 'C', changePercent: 1, volume: 0, turnover: 0 }
]
for (const [key, expected] of [['gainers', ['A','C','B']], ['losers', ['B','C','A']], ['volumeLeaders', ['B','A','C']], ['turnoverLeaders', ['A','B','C']]]) {
    test('market ranking: ' + key, () => assert.deepEqual(rankStocks(fixture)[key].map(s => s.code), expected))
}
test('market rankings: zero trades, ties and default top five are stable', () => {
    const stocks = createStocks().reverse().map(s => ({ ...s, volume: 0, turnover: 0, changePercent: 0 }))
    const before = JSON.stringify(stocks)
    const result = rankStocks(stocks)
    for (const list of Object.values(result)) {
        assert.equal(list.length, 5)
        assert.deepEqual(list.map(s => s.code), [...stocks].map(s => s.code).sort().slice(0,5))
    }
    assert.equal(JSON.stringify(stocks), before)
    assert.deepEqual(rankStocks([]).gainers, [])
})
test('market stats: aggregate actual trades per stock and Taipei date using integer cents', () => {
    const trades = [
        { stockCode: 'A', price: 99.9, quantity: 3, createdAt: '2026-10-27T16:00:00Z' },
        { stockCode: 'A', price: 100, quantity: 2, createdAt: '2026-10-28T03:00:00Z' },
        { stockCode: 'B', price: 50, quantity: 10, createdAt: '2026-10-28T03:00:00Z' },
        { stockCode: 'A', price: 100, quantity: 999, createdAt: '2026-10-27T15:59:59Z' },
        { stockCode: 'A', price: 100, quantity: 999, createdAt: '2026-10-28T16:00:00Z' }
    ]
    assert.deepEqual(marketStats(trades, 'A', now), { volume: 5, turnover: 499.7, tradeCount: 2 })
    assert.deepEqual(marketStats(trades, 'B', now), { volume: 10, turnover: 500, tradeCount: 1 })
    assert.deepEqual(marketStats(trades, 'C', now), { volume: 0, turnover: 0, tradeCount: 0 })
})
test('market seed: deterministic multi-stock legal trades with different directions and volumes', () => {
    const { isValidStockPrice, getDailyPriceLimits } = require('./index')
    const stocks = createStocks()
    const trades = generateMarketTrades(stocks, isValidStockPrice, getDailyPriceLimits, now)
    assert.deepEqual(trades, generateMarketTrades(stocks, isValidStockPrice, getDailyPriceLimits, now))
    assert.equal(new Set(trades.map(t => t.id)).size, trades.length)
    const volumes = []
    const changes = []
    for (const stock of stocks) {
        const own = trades.filter(t => t.stockCode === stock.code)
        const { limitDown, limitUp } = getDailyPriceLimits(stock)
        assert.ok(own.length > 0)
        for (const trade of own) {
            assert.ok(isValidStockPrice(trade.price))
            assert.ok(trade.price >= limitDown && trade.price <= limitUp)
            assert.ok(Date.parse(trade.createdAt) < now)
        }
        volumes.push(marketStats(trades, stock.code, now).volume)
        changes.push(own.at(-1).price - stock.referencePrice)
    }
    assert.equal(new Set(volumes).size, stocks.length)
    assert.ok(changes.some(c => c > 0) && changes.some(c => c < 0))
})

async function market(run) {
    delete require.cache[require.resolve('./index')]
    const server = require('./index').createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + server.address().port
    const client = new WebSocket(base.replace('http:', 'ws:') + '/ws')
    const events = []
    client.on('message', data => events.push(JSON.parse(data)))
    try {
        await once(client, 'open')
        const request = async (path, method = 'GET', body) => {
            const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
            const data = await response.json()
            const pong = once(client, 'pong'); client.ping(); await pong
            return { status: response.status, data }
        }
        const order = (userId, code, side, price, quantity) => request('/orders', 'POST', { userId, stockCode: code, side, price, quantity })
        await run({ request, order, events })
    } finally {
        const closed = once(client, 'close')
        await new Promise(resolve => server.close(resolve))
        await closed
    }
}
test('HTTP: 12 stocks, each category >=3, all detail routes and orders support each code', () => market(async ({ request, order }) => {
    const stocks = (await request('/stocks')).data
    assert.equal(stocks.length, 12)
    for (const category of ['YouTube','Twitch','VTuber','KOL']) assert.equal(stocks.filter(s => s.category === category).length, 3)
    for (const stock of stocks) {
        for (const key of ['code','name','category','price','previousClose','referencePrice','change','changePercent','limitUp','limitDown','tickSize','volume','turnover','tradeCount']) assert.ok(Object.hasOwn(stock,key), key)
        for (const path of ['/stocks/', '/orderbook/', '/trades/', '/candles/']) assert.equal((await request(path + stock.code)).status, 200)
        assert.equal(stock.volume, 0)
        assert.equal((await order(1, stock.code, 'buy', stock.price, 1)).status, 201)
    }
    const rankings = (await request('/market/rankings')).data
    assert.deepEqual(rankings, rankStocks((await request('/stocks')).data))
}))
test('WS market: KO001 fill updates only that stock and public stats, preserves unrelated stock', () => market(async ({ request, order, events }) => {
    const before = (await request('/stocks/YT002')).data
    assert.equal((await order(2, 'KO001', 'sell', 25, 20)).status, 201)
    assert.equal((await request('/stocks/KO001')).data.volume, 0)
    events.length = 0
    await order(1, 'KO001', 'buy', 25, 7)
    await order(1, 'KO001', 'buy', 25, 3)
    const updates = events.filter(e => e.type === 'stock:update')
    assert.equal(updates.length, 2)
    assert.ok(updates.every(e => e.stockCode === 'KO001' && e.data.code === 'KO001'))
    assert.deepEqual(updates.map(e => [e.data.volume,e.data.turnover,e.data.tradeCount]), [[7,175,1],[10,250,2]])
    assert.equal(updates.at(-1).data.price, 25)
    assert.equal(updates.at(-1).data.changePercent, 0)
    assert.deepEqual((await request('/stocks/YT002')).data, before)
    assert.deepEqual((await request('/stocks/KO001')).data, updates.at(-1).data)
    const holdings = (await request('/accounts/1')).data.holdings
    assert.equal(holdings.find(h => h.stockCode === 'KO001').quantity, 10)
    assert.equal((await request('/trades/KO001')).data.length, 2)
    const candles = (await request('/candles/KO001')).data
    assert.equal(candles.reduce((sum,c) => sum+c.volume,0), 10)
    const buy = (await order(1, 'TW003', 'buy', 120, 2)).data.order
    assert.equal((await request('/orders/' + buy.id + '?userId=1', 'DELETE')).status, 200)
}))

test('frontend market: category, code/name search and combined filters', async () => {
    const { filterStocks } = await import('../src/marketHelpers.mjs')
    const stocks = createStocks()
    assert.equal(filterStocks(stocks, 'YouTube', '').length, 3)
    assert.deepEqual(filterStocks(stocks, '全部', 'yt002').map(s => s.code), ['YT002'])
    assert.deepEqual(filterStocks(stocks, '全部', ' nOvA ').map(s => s.code), ['YT002'])
    assert.equal(filterStocks(stocks, 'Twitch', 'Nova').length, 0)
    assert.deepEqual(filterStocks(stocks, 'YouTube', 'nova').map(s => s.code), ['YT002'])
})
test('frontend market: one-stock update reorders all rankings without mutating others', async () => {
    const { marketRankings, updateMarket } = await import('../src/marketHelpers.mjs')
    const next = updateMarket(fixture, { ...fixture[2], changePercent: 9, volume: 100, turnover: 1000 })
    assert.equal(next[0], fixture[0])
    assert.equal(next[1], fixture[1])
    for (const key of ['gainers','volumeLeaders','turnoverLeaders']) assert.equal(marketRankings(next)[key][0].code, 'C')
    assert.deepEqual(marketRankings(next), rankStocks(next))
    assert.equal(fixture[2].volume, 0)
})

test('market startup: seeded HTTP history, prices, rankings and unchanged cash/shares', async () => {
    const { promisify } = require('node:util')
    const { execFile } = require('node:child_process')
    const script = `
        const assert = require('node:assert/strict')
        const fs = require('node:fs')
        const Module = require('node:module')
        const filename = require.resolve('./server/index')
        const mod = new Module(filename, module)
        mod.filename = filename; mod.paths = module.paths
        mod._compile(fs.readFileSync(filename, 'utf8').replace('const PORT = 3000', 'const PORT = 0'), filename)
        const server = mod.exports.startServer()
        server.on('listening', async () => {
            try {
                assert.equal(server.address().address, '127.0.0.1')
                const read = async path => {
                    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path)
                    assert.equal(response.status, 200)
                    return response.json()
                }
                const stocks = await read('/stocks')
                assert.equal(stocks.length, 12)
                assert.ok(stocks.some(s => s.changePercent > 0) && stocks.some(s => s.changePercent < 0))
                for (const stock of stocks) {
                    const trades = await read('/trades/' + stock.code)
                    assert.ok(trades.length > 0)
                    assert.equal(stock.price, trades[0].price)
                    const candles = await read('/candles/' + stock.code)
                    assert.equal(candles.reduce((sum,c) => sum+c.tradeCount,0), trades.length)
                }
                const accounts = await read('/accounts')
                for (const account of accounts) {
                    assert.equal(account.cash, 1000000)
                    assert.equal(account.reservedCash, 0)
                    assert.equal(account.holdings.find(h => h.stockCode === 'YT001').quantity, 2000)
                }
                assert.deepEqual(await read('/orders'), [])
                assert.deepEqual(await read('/market/rankings'), require('./server/market').rankStocks(stocks))
            } catch (error) { console.error(error); process.exitCode = 1 }
            finally { server.close() }
        })
    `
    await promisify(execFile)(process.execPath, ['-e', script], {
        cwd: require('node:path').resolve(__dirname, '..'), timeout: 15000,
        env: { ...process.env, NODE_ENV: 'development', NIOUSTOCK_SEED_MARKET: '1', NIOUSTOCK_SEED_CANDLES: '' }
    })
})
test('market startup: seed rejected in production before listening', () => {
    const previous = { node: process.env.NODE_ENV, market: process.env.NIOUSTOCK_SEED_MARKET }
    try {
        process.env.NODE_ENV = 'production'
        process.env.NIOUSTOCK_SEED_MARKET = '1'
        assert.throws(() => require('./index').startServer(), /local development only/)
    } finally {
        if (previous.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.node
        if (previous.market === undefined) delete process.env.NIOUSTOCK_SEED_MARKET; else process.env.NIOUSTOCK_SEED_MARKET = previous.market
    }
})

test('dense market seed: distinct interval counts, intraminute ranges and exact five-minute OHLCV', () => {
    const { aggregateCandles, bucketStart } = require('./candles')
    const { isValidStockPrice, getDailyPriceLimits } = require('./index')
    const anchor = Date.parse('2026-10-28T04:23:45Z')
    const trades = generateMarketTrades(createStocks(), isValidStockPrice, getDailyPriceLimits, anchor)
    assert.deepEqual(trades, generateMarketTrades(createStocks(), isValidStockPrice, getDailyPriceLimits, anchor))
    for (const stock of createStocks()) {
        const own = trades.filter(t => t.stockCode === stock.code)
        const one = aggregateCandles(own, '1m')
        const five = aggregateCandles(own, '5m')
        const fifteen = aggregateCandles(own, '15m')
        const hour = aggregateCandles(own, '1h')
        assert.equal(one.length, 60)
        assert.ok(five.length >= 12 && five.length <= 13)
        assert.ok(fifteen.length >= 4 && fifteen.length <= 5)
        assert.ok(hour.length >= 1 && hour.length <= 2)
        assert.ok(one.length > five.length && five.length > fifteen.length)
        assert.ok(one.every(c => c.tradeCount >= 2 && c.tradeCount <= 5))
        assert.ok(one.filter(c => c.high !== c.low).length >= 50)
        assert.ok(own.every(t => Date.parse(t.createdAt) < anchor && isValidStockPrice(t.price)))
        const limits = getDailyPriceLimits(stock)
        assert.ok(own.every(t => t.price >= limits.limitDown && t.price <= limits.limitUp))
        let fullBuckets = 0
        for (const candle of five) {
            const minutes = one.filter(c => bucketStart(c.timestamp, '5m') === candle.timestamp)
            if (minutes.length === 5) fullBuckets++
            assert.deepEqual(candle, {
                timestamp: candle.timestamp,
                open: minutes[0].open,
                high: Math.max(...minutes.map(c => c.high)),
                low: Math.min(...minutes.map(c => c.low)),
                close: minutes.at(-1).close,
                volume: minutes.reduce((sum,c) => sum + c.volume, 0),
                tradeCount: minutes.reduce((sum,c) => sum + c.tradeCount, 0)
            })
        }
        assert.ok(fullBuckets >= 11)
    }
})
