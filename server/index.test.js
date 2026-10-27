const { test } = require('node:test')
const assert = require('node:assert/strict')

async function market(run) {
    delete require.cache[require.resolve('./index')]
    const { app } = require('./index')
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.on('listening', resolve))
    const request = async (path, method = 'GET', body) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
            method, headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        })
        return { status: response.status, data: await response.json() }
    }
    const order = (userId, side, price, quantity) => request('/orders', 'POST', { userId, stockCode: 'YT001', side, price, quantity })
    const accounts = async () => (await request('/accounts')).data
    try { await run({ request, order, accounts }) }
    finally { await new Promise(resolve => server.close(resolve)) }
}

test('A: two users settle cash and shares; account compatibility and trade ownership', () => market(async ({ order, accounts, request }) => {
    await order(1, 'buy', 100, 100)
    const result = await order(2, 'sell', 100, 100)
    assert.equal(result.data.trades[0].buyerUserId, 1)
    assert.equal(result.data.trades[0].sellerUserId, 2)
    const [buyer, seller] = await accounts()
    assert.equal(buyer.cash, 990000)
    assert.equal(seller.cash, 1010000)
    assert.equal(buyer.holdings[0].quantity, 2100)
    assert.equal(seller.holdings[0].quantity, 1900)
    assert.equal(buyer.reservedCash, 0)
    assert.deepEqual((await request('/account')).data, buyer)
}))

test('B: reject self-cross before matching or reserving; cancel allows later trade', () => market(async ({ order, request, accounts }) => {
    await order(1, 'sell', 100, 20)
    await order(2, 'sell', 100.5, 10)
    const before = await accounts()
    const result = await order(1, 'buy', 101, 30)
    assert.equal(result.status, 400)
    assert.match(result.data.message, /自己的反向掛單交叉/)
    assert.deepEqual(await accounts(), before)
    assert.equal((await request('/orders?userId=1')).data.length, 1)
    assert.equal((await request('/orders?userId=2')).data.length, 1)
    assert.deepEqual((await request('/trades')).data, [])
    assert.equal((await order(1, 'buy', 100, 1)).status, 400)
    assert.equal((await order(1, 'buy', 99.9, 1)).status, 201)
    await request('/orders/1?userId=1', 'DELETE')
    const matched = await order(1, 'buy', 101, 10)
    assert.equal(matched.status, 201)
    assert.equal(matched.data.trades[0].price, 100.5)
}))

test('C–F: reject insufficient assets and repeated reservations without mutation', () => market(async ({ order, accounts }) => {
    assert.equal((await order(1, 'buy', 100, 10001)).status, 400)
    assert.equal((await order(1, 'sell', 100, 2001)).status, 400)
    await order(1, 'buy', 100, 6000)
    await order(1, 'buy', 100, 4000)
    assert.equal((await order(1, 'buy', 100, 1)).status, 400)
    await order(1, 'sell', 101, 1500)
    await order(1, 'sell', 101, 500)
    assert.equal((await order(1, 'sell', 101, 1)).status, 400)
    const [account] = await accounts()
    assert.equal(account.availableCash, 0)
    assert.equal(account.reservedCash, 1000000)
    assert.equal(account.holdings[0].availableQuantity, 0)
    assert.equal(account.holdings[0].reservedQuantity, 2000)
}))

test('G–H: partial fills, price improvement, cancellation and ownership', () => market(async ({ order, accounts, request }) => {
    const sell = (await order(2, 'sell', 100, 40)).data.order
    const buy = (await order(1, 'buy', 101, 100)).data.order
    let [buyer, seller] = await accounts()
    assert.equal(buyer.cash, 996000)
    assert.equal(buyer.reservedCash, 6060)
    assert.equal(buyer.availableCash, 989940)
    assert.equal(seller.holdings[0].reservedQuantity, 0)
    assert.equal(buy.status, 'partially_filled')
    assert.equal((await request(`/orders/${buy.id}?userId=2`, 'DELETE')).status, 403)
    await request(`/orders/${buy.id}?userId=1`, 'DELETE')
    ;[buyer] = await accounts()
    assert.equal(buyer.reservedCash, 0)
    assert.equal(buyer.availableCash, buyer.cash)
    assert.equal((await request(`/orders/${sell.id}?userId=2`, 'DELETE')).status, 400)
    const remainingSell = (await order(2, 'sell', 102, 100)).data.order
    await order(1, 'buy', 102, 25)
    ;[, seller] = await accounts()
    assert.equal(seller.holdings[0].reservedQuantity, 75)
    await request(`/orders/${remainingSell.id}?userId=2`, 'DELETE')
    ;[, seller] = await accounts()
    assert.equal(seller.holdings[0].reservedQuantity, 0)
    assert.equal(seller.holdings[0].availableQuantity, 1935)
}))

test('I: multi-level matching preserves price/time priority and conservation', () => market(async ({ order, accounts, request }) => {
    const expensive = (await order(2, 'sell', 101, 30)).data.order
    const first = (await order(2, 'sell', 100, 20)).data.order
    const second = (await order(2, 'sell', 100, 10)).data.order
    const result = await order(1, 'buy', 102, 70)
    assert.deepEqual(result.data.trades.map(trade => trade.sellOrderId), [first.id, second.id, expensive.id])
    assert.equal(result.data.order.remainingQuantity, 10)
    const [buyer, seller] = await accounts()
    assert.equal(buyer.cash, 993970)
    assert.equal(buyer.reservedCash, 1020)
    assert.equal(buyer.cash + seller.cash, 2000000)
    assert.equal(buyer.holdings[0].quantity + seller.holdings[0].quantity, 4000)
    assert.equal((await request('/stocks/YT001')).data.price, 101)
}))

test('existing rules: ticks, daily limits, integer quantities, full book aggregation', () => market(async ({ order, request }) => {
    for (const [price, quantity] of [[100.1, 1], [105, 1], [85, 1], [100, 1.5], [100, 0], [100, Number.MAX_SAFE_INTEGER + 1]]) {
        assert.equal((await order(1, 'buy', price, quantity)).status, 400)
    }
    for (const price of [99, 98, 97, 96, 95, 94]) await order(1, 'buy', price, 1)
    await order(2, 'buy', 99, 2)
    const book = (await request('/orderbook/YT001')).data
    assert.equal(book.buys.length, 6)
    assert.deepEqual(book.buys[0], { price: 99, quantity: 3 })
    const { isValidStockPrice } = require('./index')
    for (const price of [9.99, 10, 49.95, 50, 99.9, 100, 499.5, 500, 999, 1000, 1005]) assert.equal(isValidStockPrice(price), true)
    for (const price of [10.01, 50.05, 100.1, 500.5, 1001]) assert.equal(isValidStockPrice(price), false)
}))

test('incoming sell uses resting buy price and releases both remaining reservations', () => market(async ({ order, accounts }) => {
    await order(1, 'buy', 101, 50)
    const result = await order(2, 'sell', 100, 80)
    assert.equal(result.data.trades[0].price, 101)
    assert.equal(result.data.order.remainingQuantity, 30)
    const [buyer, seller] = await accounts()
    assert.equal(buyer.cash, 994950)
    assert.equal(buyer.reservedCash, 0)
    assert.equal(seller.cash, 1005050)
    assert.equal(seller.holdings[0].quantity, 1950)
    assert.equal(seller.holdings[0].reservedQuantity, 30)
    assert.equal(seller.holdings[0].availableQuantity, 1920)
}))

test('canonical prices share a book level and preserve time priority and settlement', () => market(async ({ order, request, accounts }) => {
    const first = (await order(1, 'buy', 100, 1)).data.order
    const second = (await order(1, 'buy', 100.00000001, 1)).data.order
    assert.equal(second.price, 100)
    assert.deepEqual((await request('/orderbook/YT001')).data.buys, [{ price: 100, quantity: 2 }])
    const result = await order(2, 'sell', 99.9, 2)
    assert.deepEqual(result.data.trades.map(t => t.buyOrderId), [first.id, second.id])
    assert.deepEqual(result.data.trades.map(t => t.price), [100, 100])
    const [buyer, seller] = await accounts()
    assert.equal(buyer.cash, 999800)
    assert.equal(seller.cash, 1000200)
    assert.equal(buyer.reservedCash, 0)
    assert.equal((await request('/stocks/YT001')).data.price, 100)
    assert.deepEqual((await request('/orderbook/YT001')).data.buys, [])
}))

test('self-cross rejection is symmetric and cannot skip a better own offer', () => market(async ({ order, request, accounts }) => {
    await order(1, 'sell', 100, 10)
    await order(2, 'sell', 101, 10)
    const before = await accounts()
    assert.equal((await order(1, 'buy', 101, 10)).status, 400)
    assert.deepEqual(await accounts(), before)
    assert.deepEqual((await request('/trades')).data, [])
    await request('/orders/1?userId=1', 'DELETE')
    const result = await order(1, 'buy', 101, 10)
    assert.equal(result.data.trades[0].price, 101)
    // Filled own buy no longer blocks an opposite sell.
    assert.equal((await order(1, 'sell', 100, 1)).status, 201)
    await request('/orders/4?userId=1', 'DELETE')
    await order(1, 'buy', 100, 10)
    assert.equal((await order(1, 'sell', 100, 1)).status, 400)
    assert.equal((await order(1, 'sell', 99.9, 1)).status, 400)
    assert.equal((await order(1, 'sell', 100.5, 1)).status, 201)
}))

test('partially filled self orders block crossings; filled and cancelled levels disappear', () => market(async ({ order, request, accounts }) => {
    const sell = (await order(1, 'sell', 100, 10)).data.order
    await order(2, 'buy', 100, 4)
    assert.deepEqual((await request('/orderbook/YT001')).data.sells, [{ price: 100, quantity: 6 }])
    const before = await accounts()
    assert.equal((await order(1, 'buy', 100.00000001, 1)).status, 400)
    assert.deepEqual(await accounts(), before)
    assert.equal((await request('/orders?userId=1')).data[0].status, 'partially_filled')
    await request(`/orders/${sell.id}?userId=1`, 'DELETE')
    assert.deepEqual((await request('/orderbook/YT001')).data, { stockCode: 'YT001', buys: [], sells: [] })
    assert.equal((await order(1, 'buy', 100, 1)).status, 201)
    await order(2, 'sell', 100, 1)
    assert.deepEqual((await request('/orderbook/YT001')).data, { stockCode: 'YT001', buys: [], sells: [] })
    assert.equal((await order(1, 'sell', 100, 1)).status, 201)
}))

test('partially filled own buy also blocks incoming sell without mutations', () => market(async ({ order, request, accounts }) => {
    await order(1, 'buy', 101, 10)
    await order(2, 'sell', 100, 4)
    const before = await accounts()
    const history = (await request('/orders?userId=1')).data
    assert.equal(history[0].status, 'partially_filled')
    assert.equal((await order(1, 'sell', 100, 1)).status, 400)
    assert.deepEqual(await accounts(), before)
    assert.deepEqual((await request('/orders?userId=1')).data, history)
}))

test('exact three-level fill leaves precise statuses, quantities and reservations', () => market(async ({ order, request, accounts }) => {
    await order(2, 'sell', 100, 30)
    await order(2, 'sell', 100.5, 40)
    await order(2, 'sell', 101, 50)
    const result = await order(1, 'buy', 101, 100)
    assert.deepEqual(result.data.trades.map(t => [t.price, t.quantity]), [[100, 30], [100.5, 40], [101, 30]])
    assert.equal(result.data.order.status, 'filled')
    assert.equal(result.data.order.remainingQuantity, 0)
    const history = (await request('/orders?userId=2')).data
    assert.deepEqual(history.map(o => [o.status, o.remainingQuantity]), [['filled', 0], ['filled', 0], ['partially_filled', 20]])
    const [buyer, seller] = await accounts()
    assert.deepEqual([buyer.cash, buyer.availableCash, buyer.reservedCash], [989950, 989950, 0])
    assert.deepEqual([seller.cash, seller.availableCash, seller.reservedCash], [1010050, 1010050, 0])
    assert.deepEqual(buyer.holdings.filter(h => h.stockCode === 'YT001').map(h => [h.quantity, h.availableQuantity, h.reservedQuantity]), [[2100, 2100, 0]])
    assert.deepEqual(seller.holdings.filter(h => h.stockCode === 'YT001').map(h => [h.quantity, h.availableQuantity, h.reservedQuantity]), [[1900, 1880, 20]])
    assert.equal(buyer.cash + seller.cash, 2000000)
    assert.equal(buyer.holdings[0].quantity + seller.holdings[0].quantity, 4000)
    assert.equal(buyer.totalAssets, buyer.cash + buyer.holdingsValue)
    assert.deepEqual((await request('/orderbook/YT001')).data.sells, [{ price: 101, quantity: 20 }])
}))

test('frontend price steps are bounded and correct across all tick boundaries', async () => {
    const { stepPrice } = await import('../src/priceSteps.mjs')
    for (const [price, up, down] of [[10, 10.05, 9.99], [50, 50.1, 49.95], [100, 100.5, 99.9], [500, 501, 499.5], [1000, 1005, 999]]) {
        assert.equal(stepPrice(price, 1, 0.01, 2000), up)
        assert.equal(stepPrice(price, -1, 0.01, 2000), down)
    }
    assert.equal(stepPrice(99.9, 1, 85.4, 104), 100)
    for (const direction of [1, -1]) {
        assert.equal(stepPrice('1e308', direction, 85.4, 104), 104)
        assert.equal(stepPrice('-1e308', direction, 85.4, 104), 85.4)
        assert.equal(stepPrice('Infinity', direction, 85.4, 104), null)
        assert.equal(stepPrice('invalid', direction, 85.4, 104), null)
    }
    assert.equal(stepPrice(104, 1, 85.4, 104), 104)
    assert.equal(stepPrice(85.4, -1, 85.4, 104), 85.4)
    assert.equal(stepPrice(100.1, 1, 85.4, 104), 100.5)
    assert.equal(stepPrice(100.1, -1, 85.4, 104), 100)
})

test('cancel UI preserves successful DELETE result when refresh fails', async () => {
    const fs = require('node:fs')
    const vm = require('node:vm')
    const source = fs.readFileSync(require.resolve('../src/pages/StockDetail.jsx'), 'utf8')
    const handler = source.slice(source.indexOf('    async function cancelOrder('), source.indexOf('    if (loading)'))
    for (const [ok, refreshFails, expected] of [[true, true, '訂單取消成功；資料更新失敗，請重新整理'], [true, false, '訂單取消成功'], [false, false, '只能取消自己的訂單']]) {
        let message, busyState, refreshCalls = 0
        const context = vm.createContext({
            busy: false, setBusy: value => { busyState = value },
            setMessage: value => { message = value },
            fetch: async () => ({ ok, json: async () => ({ message: '只能取消自己的訂單' }) }),
            refreshAll: async () => { refreshCalls++; if (refreshFails) throw new Error('network') }
        })
        vm.runInContext(handler, context)
        await context.cancelOrder(1)
        assert.equal(message, expected)
        assert.equal(busyState, false)
        assert.equal(refreshCalls, ok ? 1 : 0)
    }
})
