const { test } = require('node:test')
const assert = require('node:assert/strict')
const { tradeHistory } = require('./tradeHistory')
const { historyQuery, formatPnl } = require('../src/tradeHistory.mjs')
async function market(run) {
    delete require.cache[require.resolve('./index')]
    const server = require('./index').createServer()
    server.listen(0, '127.0.0.1')
    await require('node:events').once(server, 'listening')
    const request = async (path, method = 'GET', body) => {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path, {
            method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body)
        })
        return { status: response.status, data: await response.json() }
    }
    const order = (userId, side, price, quantity, stockCode = 'YT001') => request('/orders', 'POST', { userId, side, price, quantity, stockCode })
    const history = async (id = 1, query = '') => (await request('/accounts/' + id + '/trades' + query)).data
    try { await run({ request, order, history }) } finally { await new Promise(resolve => server.close(resolve)) }
}
test('history: buyer and seller share one execution with fixed settlement cost and PnL', () => market(async ({ order, history, request }) => {
    await order(1, 'buy', 100, 10); await order(2, 'sell', 100, 10)
    const buyer = (await history(1)).items[0], seller = (await history(2)).items[0]
    assert.equal(buyer.side, 'buy'); assert.equal(seller.side, 'sell')
    assert.equal(buyer.realizedPnl, 0); assert.equal(seller.realizedPnl, 52)
    assert.equal(seller.averageCostAtTrade, 94.8)
    for (const key of ['tradeId', 'quantity', 'price', 'amount']) assert.equal(buyer[key], seller[key])
    assert.equal((await request('/trades')).data.length, 1)
    assert.equal((await order(1, 'sell', 101, 100)).status, 201)
    assert.equal((await order(2, 'buy', 101, 100)).status, 201)
    assert.notEqual((await request('/accounts/2')).data.holdings[0].averageCost, 94.8)
    assert.deepEqual((await history(2)).items.find(t => t.tradeId === seller.tradeId), seller)
}))
test('history: partial fill, cancel and rejected self-cross create no extra records', () => market(async ({ order, history, request }) => {
    const pending = (await order(1, 'buy', 100, 100)).data.order
    assert.equal((await history()).items.length, 0)
    assert.equal((await order(1, 'sell', 100, 10)).status, 400)
    await order(2, 'sell', 100, 30)
    assert.equal((await history()).items[0].quantity, 30)
    await request('/orders/' + pending.id + '?userId=1', 'DELETE')
    assert.equal((await history()).items.length, 1)
}))
test('history: multi-level execution records, filtered summaries and pagination', () => market(async ({ order, history }) => {
    for (const [price, quantity] of [[100,10], [101,20], [102,30]]) await order(1, 'buy', price, quantity)
    await order(2, 'sell', 100, 60)
    const all = await history(2)
    assert.deepEqual(all.items.map(t => [t.price,t.quantity,t.amount,t.realizedPnl]), [[100,10,1000,52],[101,20,2020,124],[102,30,3060,216]])
    const paged = await history(2, '?page=2&limit=1')
    assert.equal(paged.items.length, 1); assert.deepEqual(paged.summary, all.summary)
    assert.deepEqual(paged.pagination, {page:2,limit:1,totalItems:3,totalPages:3})
    assert.equal((await history(2, '?page=99')).items.length, 0)
    assert.equal((await history(2, '?side=buy')).summary.totalSells, 0)
    assert.equal((await history(2, '?side=sell')).summary.totalSellAmount, 6080)
    assert.equal((await history(2, '?stockCode=YT002')).items.length, 0)
    assert.equal((await history(2, '?stockCode=YT001')).items.length, 3)
}))
test('history: public REST exposes only public fields', () => market(async ({ order, request }) => {
    await order(1, 'buy', 100, 10); await order(2, 'sell', 100, 10)
    for (const path of ['/trades', '/trades/YT001']) {
        const trade = (await request(path)).data[0]
        assert.deepEqual(Object.keys(trade).sort(), ['id','stockCode','price','quantity','createdAt'].sort())
    }
}))
test('history: invalid API filters return 400 and unknown user returns 404', () => market(async ({ request, history }) => {
    for (const query of ['side=hold','side=','page=0','page=1.2','page=abc','limit=0','limit=101','limit=1&limit=2','from=bad','from=2026-02-30','to=2026-10-01&from=2026-10-02','from=2026-10-01T00:00:00']) {
        assert.equal((await request('/accounts/1/trades?' + query)).status, 400, query)
    }
    assert.equal((await request('/accounts/999/trades')).status,404)
    assert.deepEqual((await history()).pagination,{page:1,limit:20,totalItems:0,totalPages:0})
}))
const fixture = (id, createdAt, extra = {}) => ({ id, stockCode:'A', buyerUserId:1, sellerUserId:2, price:60, quantity:10,
    sellerAverageCostAtTrade:50, sellerRealizedPnl:100, sellerRealizedPnlMicros:100000000n, buyerAverageCostAfter:60, createdAt, ...extra })
test('history: Taipei dates include full to day, ISO bounds are half open; ties use descending id', () => {
    const trades = [fixture(1,'2026-10-01T15:59:59.999Z'),fixture(2,'2026-10-01T16:00:00Z'),fixture(3,'2026-10-01T15:59:59.999Z')]
    assert.deepEqual(tradeHistory(trades,[],2,{from:'2026-10-01',to:'2026-10-01'}).items.map(t=>t.id),[3,1])
    assert.deepEqual(tradeHistory(trades,[],2,{from:'2026-10-01T15:59:59.999Z',to:'2026-10-01T16:00:00Z'}).items.map(t=>t.id),[3,1])
    assert.equal(tradeHistory(trades,[],2,{from:'2026-10-02'}).summary.realizedPnl,100)
})
test('history: both market seed generators are excluded, even if simulated records carry owners', () => {
    const { createStocks } = require('./stockFixtures')
    const { isValidStockPrice, getDailyPriceLimits } = require('./index')
    const seeds = [...require('./seedMarket').generateMarketTrades(createStocks(),isValidStockPrice,getDailyPriceLimits), ...require('./seedCandles').generateSeedTrades()]
    assert.ok(seeds.length > 0)
    assert.equal(tradeHistory([...seeds,fixture(999,'2026-10-01T00:00:00Z',{simulated:true})],[],1).pagination.totalItems,0)
})
test('history: micro precision summaries round once over all filtered executions', () => {
    const trades = [1,2,3].map(id=>fixture(id,'2026-10-01T00:00:00Z',{sellerRealizedPnlMicros:3333n,sellerRealizedPnl:0}))
    assert.equal(tradeHistory(trades,[],2,{limit:'1'}).summary.realizedPnl,0.01)
})
test('history frontend: query encodes filters and rolling date range; signed amounts', () => {
    const query = new URLSearchParams(historyQuery({stockCode:' YT002 ',side:'sell',days:'7'},2,Date.parse('2026-10-30T00:00:00Z')))
    assert.equal(query.get('from'),'2026-10-23T00:00:00.000Z')
    assert.equal(query.get('stockCode'),'YT002'); assert.equal(query.get('page'),'2'); assert.equal(query.get('side'),'sell')
    assert.equal(formatPnl(100),'+100.00'); assert.equal(formatPnl(-100),'-100.00')
})
