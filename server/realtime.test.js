const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { WebSocket } = require('ws')
const { aggregateCandles, bucketStart } = require('./candles')
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
            const pong = once(client, 'pong')
            client.ping()
            await pong
            return { status: response.status, data }
        }
        const order = (userId, side, price, quantity) => request('/orders', 'POST', { userId, side, price, quantity, stockCode: 'YT001' })
        await run({ events, order, request, client })
    } finally {
        const closed = once(client, 'close')
        await new Promise(resolve => server.close(resolve))
        await closed
    }
}
test('WS-A: connection and server shutdown with active client', () => market(async ({ client }) => {
    assert.equal(client.readyState, WebSocket.OPEN)
}))
test('WS-B: unmatched orders publish only full public book', () => market(async ({ order, events }) => {
    for (const price of [99, 98, 97, 96, 95, 94]) await order(1, 'buy', price, 10)
    assert.deepEqual(events.map(e => e.type), Array(6).fill('orderbook:update'))
    assert.equal(events.at(-1).data.buys.length, 6)
}))
test('WS-C: actual fill publishes public trade, stock, candles and final book', () => market(async ({ order, events, request }) => {
    await order(2, 'sell', 101, 10)
    events.length = 0
    await order(1, 'buy', 101, 10)
    assert.deepEqual(events.map(e => e.type), ['trade:new', 'stock:update', ...Array(5).fill('candle:update'), 'orderbook:update'])
    assert.deepEqual(Object.keys(events[0].data).sort(), ['createdAt', 'id', 'price', 'quantity', 'stockCode'])
    assert.equal(events[1].data.price, 101)
    for (const event of events.filter(e => e.type === 'candle:update')) assert.deepEqual((await request('/candles/YT001?interval=' + event.data.interval)).data.at(-1), event.data.candle)
    assert.deepEqual(events.at(-1).data, { stockCode: 'YT001', buys: [], sells: [] })
    assert.doesNotMatch(JSON.stringify(events), /userId|UserId|cash|holdings|OrderId/)
}))
test('WS-D: cancel emits only book; rejected actions emit nothing', () => market(async ({ order, events, request }) => {
    await order(1, 'buy', 100, 10)
    events.length = 0
    await request('/orders/1?userId=2', 'DELETE')
    await order(1, 'sell', 100, 1)
    assert.deepEqual(events, [])
    await request('/orders/1?userId=1', 'DELETE')
    assert.deepEqual(events.map(e => e.type), ['orderbook:update'])
    assert.deepEqual(events[0].data.buys, [])
}))
test('WS-E: partial fill publishes remaining quantity', () => market(async ({ order, events }) => {
    await order(2, 'sell', 100, 40)
    await order(1, 'buy', 100, 15)
    assert.deepEqual(events.at(-1).data.sells, [{ price: 100, quantity: 25 }])
}))
test('WS: multi-level fill publishes each trade and cumulative candle', () => market(async ({ order, events }) => {
    await order(2, 'sell', 100, 10)
    await order(2, 'sell', 101, 20)
    events.length = 0
    await order(1, 'buy', 101, 30)
    assert.deepEqual(events.filter(e => e.type === 'trade:new').map(e => e.data.price), [100, 101])
    const daily = events.filter(e => e.type === 'candle:update' && e.data.interval === '1d')
    assert.equal(daily.at(-1).data.candle.volume, 30)
    assert.equal(daily.at(-1).data.candle.tradeCount, 2)
}))
function trade(id, price, quantity, createdAt) { return { id, price, quantity, createdAt } }
test('candles: exact OHLC, volume, count, sorting and next minute', () => {
    const trades = [100, 101, 99.5, 100.5].map((price, i) => trade(i + 1, price, (i + 1) * 10, '2026-10-27T02:00:0' + i + 'Z'))
    assert.deepEqual(aggregateCandles([...trades].reverse(), '1m'), [{ timestamp: Date.parse('2026-10-27T02:00:00Z'), open: 100, high: 101, low: 99.5, close: 100.5, volume: 100, tradeCount: 4 }])
    trades.push(trade(5, 102, 5, '2026-10-27T02:01:00Z'))
    assert.equal(aggregateCandles(trades, '1m').length, 2)
    assert.deepEqual(aggregateCandles([], '1m'), [])
})
for (const [interval, duration] of [['5m', 300000], ['15m', 900000], ['1h', 3600000], ['1d', 86400000]]) {
    test('candles: ' + interval + ' aggregation and boundary', () => {
        const start = bucketStart('2026-10-27T02:17:19Z', interval)
        const candles = aggregateCandles([trade(1, 100, 10, start), trade(2, 101, 20, start + duration - 1), trade(3, 99, 5, start + duration)], interval)
        assert.equal(candles.length, 2)
        assert.deepEqual(candles[0], { timestamp: start, open: 100, high: 101, low: 100, close: 101, volume: 30, tradeCount: 2 })
        assert.equal(candles[1].timestamp, start + duration)
        if (interval === '1d') assert.equal(new Date(start).toISOString(), '2026-10-26T16:00:00.000Z')
    })
}
test('candle API: empty, interval validation, bounded limit and unknown stock', () => market(async ({ request, order }) => {
    assert.deepEqual((await request('/candles/YT001')).data, [])
    for (const interval of ['2m', 'constructor', 'toString', '']) assert.equal((await request('/candles/YT001?interval=' + interval)).status, 400)
    for (const limit of ['0', '-1', '501', '1.5', 'Infinity', '999999999999999999', '']) assert.equal((await request('/candles/YT001?limit=' + limit)).status, 400)
    assert.equal((await request('/candles/UNKNOWN')).status, 404)
    await order(2, 'sell', 100, 10)
    await order(1, 'buy', 100, 10)
    assert.equal((await request('/candles/YT001?limit=1')).data.length, 1)
    assert.equal((await request('/candles/YT001?limit=500')).status, 200)
}))
test('frontend: deduplicate trades, newest first and cap history', async () => {
    const { addTrade } = await import('../src/marketUpdates.mjs')
    const trades = Array.from({ length: 100 }, (_, id) => trade(id, 100, 1, '2026-10-27T02:00:00Z'))
    const next = addTrade(trades, trade(100, 101, 2, '2026-10-27T02:00:00Z'))
    assert.equal(next.length, 100)
    assert.equal(next[0].id, 100)
    assert.deepEqual(addTrade(next, next[0]), next)
})
test('frontend: candle replace, append, ignore stale and cap history', async () => {
    const { updateCandle } = await import('../src/marketUpdates.mjs')
    let candles = updateCandle([], { timestamp: 1, close: 100 })
    candles = updateCandle(candles, { timestamp: 1, close: 101 })
    assert.deepEqual(candles, [{ timestamp: 1, close: 101 }])
    candles = updateCandle(candles, { timestamp: 2, close: 102 })
    assert.equal(candles.length, 2)
    assert.deepEqual(updateCandle(candles, { timestamp: 1 }), candles)
    for (let timestamp = 3; timestamp < 105; timestamp++) candles = updateCandle(candles, { timestamp })
    assert.equal(candles.length, 100)
})
