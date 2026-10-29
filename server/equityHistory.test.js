const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createEquityHistory, recordAffectedEquity, MAX_POINTS } = require('./equityHistory')
const { generateEquityHistory } = require('./equityHistorySeed')
const { toEquityChartData, formatEquityTime, formatEquityChange, EQUITY_RANGES } = require('../src/equityHistory.mjs')
const NOW = Date.parse('2026-10-30T08:00:00Z')
const DAY = 86400000

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
    const order = (userId, side, price, quantity) => request('/orders', 'POST', { userId, stockCode: 'YT001', side, price, quantity })
    const history = async id => (await request('/accounts/' + id + '/equity-history')).data
    try { await run({ request, order, history }) } finally { await new Promise(resolve => server.close(resolve)) }
}

test('equity: initializes both users once; HTTP reads do not record or change accounts', () => market(async ({ request, history }) => {
    const before = (await request('/accounts')).data
    for (const account of before) {
        const first = await history(account.id)
        assert.equal(first.range, 'ALL')
        assert.equal(first.points.length, 1)
        const point = first.points[0]
        assert.equal(point.userId, account.id)
        assert.ok(Number.isInteger(point.id))
        assert.equal(point.totalAssets, account.totalAssets)
        assert.equal(point.cash, account.cash)
        assert.equal(point.holdingsValue, account.holdingsValue)
        assert.deepEqual(await history(account.id), first)
        await request('/portfolio/' + account.id)
        assert.deepEqual(await history(account.id), first)
    }
    assert.deepEqual((await request('/accounts')).data, before)
}))

test('equity: buyer and seller record post-price settlement once, without adding realized PnL twice', () => market(async ({ request, order, history }) => {
    const before = (await request('/accounts')).data
    assert.equal((await order(1, 'buy', 101, 10)).status, 201)
    assert.equal((await history(1)).points.length, 1)
    assert.equal((await order(2, 'sell', 101, 10)).status, 201)
    const after = (await request('/accounts')).data
    for (const account of after) {
        const points = (await history(account.id)).points
        assert.equal(points.length, 2)
        assert.equal(points.at(-1).cash, account.cash)
        assert.equal(points.at(-1).holdingsValue, account.holdingsValue)
        assert.equal(points.at(-1).totalAssets, account.totalAssets)
        assert.equal(account.totalAssets - before[account.id - 1].totalAssets, 2000)
        assert.equal(account.totalAssets, (Math.round(account.cash * 100) + Math.round(account.holdingsValue * 100)) / 100)
    }
    assert.equal(after[0].cash, 998990)
    assert.equal(after[1].cash, 1001010)
    assert.equal(after[1].realizedPnl, 62)
    assert.deepEqual((await request('/accounts')).data, after)
}))

test('equity: unchanged trade price still records cash/holdings changes; cancellation and rejection do not', () => market(async ({ request, order, history }) => {
    const pending = (await order(1, 'buy', 100, 100)).data.order
    assert.equal((await order(1, 'sell', 100, 10)).status, 400)
    await order(2, 'sell', 100, 30)
    const points = (await history(1)).points
    assert.equal(points.length, 2)
    assert.equal(points[0].totalAssets, points[1].totalAssets)
    assert.equal(points[1].cash, points[0].cash - 3000)
    assert.equal(points[1].holdingsValue, points[0].holdingsValue + 3000)
    await request('/orders/' + pending.id + '?userId=1', 'DELETE')
    assert.deepEqual((await history(1)).points, points)
}))

test('equity: multi-level fills record each completed valuation with ordered unique IDs', () => market(async ({ order, history }) => {
    await order(1, 'buy', 100, 10); await order(1, 'buy', 101, 20); await order(1, 'buy', 102, 30)
    await order(2, 'sell', 100, 60)
    for (const userId of [1, 2]) {
        const points = (await history(userId)).points
        assert.equal(points.length, 4)
        assert.equal(new Set(points.map(p => p.id)).size, 4)
        assert.ok(points.every((p, i) => i === 0 || p.timestamp >= points[i - 1].timestamp))
    }
}))

test('equity: affected holders reflect price change with constant cash; nonholders are not recorded', () => {
    const store = createEquityHistory()
    const users = [{ id: 1, cash: 1000, holdings: { A: { quantity: 100 } } },
        { id: 2, cash: 1000, holdings: {} }, { id: 3, cash: 1000, holdings: { A: { quantity: 0 } } }]
    let price = 100
    const value = user => ({ cash: user.cash, holdingsValue: (user.holdings.A?.quantity || 0) * price })
    for (const user of users) store.record(user.id, value(user), NOW - 1)
    const before = structuredClone(users)
    price = 101
    const called = []
    recordAffectedEquity(store, users, 'A', new Set(), true, user => { called.push(user.id); return value(user) }, NOW)
    assert.deepEqual(called, [1])
    assert.equal(store.read(1, 'ALL', NOW).points.length, 2)
    assert.equal(store.read(1, 'ALL', NOW).summary.change, 100)
    assert.equal(store.read(1, 'ALL', NOW).points.at(-1).cash, 1000)
    assert.equal(store.read(2, 'ALL', NOW).points.length, 1)
    assert.equal(store.read(3, 'ALL', NOW).points.length, 1)
    assert.deepEqual(users, before)
    called.length = 0
    recordAffectedEquity(store, users, 'A', new Set(), false, user => { called.push(user.id); return value(user) }, NOW)
    assert.deepEqual(called, [])
})

test('equity: dedupe compares cash and holdings, rounds cents and never mutates valuation', () => {
    const store = createEquityHistory()
    const valuation = Object.freeze({ cash: 1000, holdingsValue: 203959.999999 })
    assert.equal(store.record(1, valuation, NOW), true)
    assert.equal(store.record(1, { cash: 1000, holdingsValue: 203960 }, NOW), false)
    assert.equal(store.record(1, valuation, NOW + 1), false)
    assert.equal(store.record(1, { cash: 1100, holdingsValue: 203860 }, NOW + 2), true)
    const result = store.read(1, 'ALL', NOW + 2)
    assert.equal(result.points.length, 2)
    assert.equal(result.points[0].totalAssets, 204960)
    result.points[0].cash = 0
    assert.equal(store.read(1, 'ALL', NOW + 2).points[0].cash, 1000)
})

for (const [range, days] of [['1D', 1], ['1W', 7], ['1M', 30], ['ALL', 40]]) {
    test('equity range ' + range + ': inclusive rolling cutoff, chronological points, excludes future', () => {
        const store = createEquityHistory()
        for (let i = 40; i >= -1; i--) store.record(1, { cash: 100, holdingsValue: 50 + i }, NOW - i * DAY)
        const result = store.read(1, range, NOW)
        assert.equal(result.points.length, days + 1)
        assert.equal(Date.parse(result.points[0].timestamp), NOW - days * DAY)
        assert.equal(Date.parse(result.points.at(-1).timestamp), NOW)
        assert.ok(result.points.every((p, i) => i === 0 || p.timestamp > result.points[i - 1].timestamp))
    })
}

test('equity summary: exact cent change, high/low, zero start and empty range', () => {
    const store = createEquityHistory()
    for (const [i, value] of [100.1, 150.2, 80.3, 120.4].entries()) store.record(1, {cash:0, holdingsValue:value}, NOW + i)
    assert.deepEqual(store.read(1, 'ALL', NOW + 3).summary, { startValue:100.1, endValue:120.4, change:20.3, changePercent:20.28, high:150.2, low:80.3 })
    store.record(2, {cash:0, holdingsValue:0}, NOW)
    store.record(2, {cash:10, holdingsValue:0}, NOW + 1)
    assert.equal(store.read(2, 'ALL', NOW + 1).summary.changePercent, 0)
    assert.deepEqual(store.read(1, '1D', NOW + 2 * DAY).summary, { startValue:0, endValue:0, change:0, changePercent:0, high:0, low:0 })
    assert.deepEqual(store.read(99, 'ALL', NOW).points, [])
})

test('equity downsampling: all ranges <=500 points, keeps endpoints; high includes unsampled spike', () => {
    const store = createEquityHistory()
    for (let i = 0; i < 2001; i++) store.record(1, {cash:0, holdingsValue:i === 1 ? 9999 : i}, NOW - 2000 + i)
    for (const range of EQUITY_RANGES) {
        const result = store.read(1, range, NOW)
        assert.equal(result.points.length, MAX_POINTS)
        assert.equal(result.points[0].totalAssets, 0)
        assert.equal(result.points.at(-1).totalAssets, 2000)
        assert.equal(result.summary.high, 9999)
        assert.ok(!result.points.some(p => p.totalAssets === 9999))
        assert.ok(result.points.every((p, i) => i === 0 || p.timestamp > result.points[i - 1].timestamp))
    }
})

test('equity API: range validation and unknown user', () => market(async ({ request }) => {
    for (const query of ['range=bad', 'range=', 'range=1d', 'range=1D&range=ALL', 'range[x]=1D']) {
        assert.equal((await request('/accounts/1/equity-history?' + query)).status, 400, query)
    }
    for (const range of EQUITY_RANGES) assert.equal((await request('/accounts/1/equity-history?range=' + range)).status, 200)
    assert.equal((await request('/accounts/999/equity-history')).status, 404)
}))

test('equity seed: deterministic hourly 30-day fluctuation, cents, constant cash and exact current endpoint', () => {
    const valuation = Object.freeze({cash:1000000, holdingsValue:208200, totalAssets:1208200})
    const points = generateEquityHistory(1, valuation, NOW)
    assert.deepEqual(points, generateEquityHistory(1, valuation, NOW))
    assert.equal(points.length, 721)
    assert.equal(Date.parse(points.at(-1).timestamp) - Date.parse(points[0].timestamp), 30 * DAY)
    assert.equal(points.at(-1).totalAssets, valuation.totalAssets)
    assert.equal(points.at(-1).holdingsValue, valuation.holdingsValue)
    assert.ok(points.some((p, i) => i && p.totalAssets < points[i - 1].totalAssets))
    assert.ok(points.some((p, i) => i && p.totalAssets > points[i - 1].totalAssets))
    assert.ok(points.every((p, i) => p.cash === valuation.cash && (i === 0 || p.timestamp > points[i - 1].timestamp)))
    for (const p of points) {
        assert.equal(p.totalAssets, (Math.round(p.cash * 100) + Math.round(p.holdingsValue * 100)) / 100)
        assert.equal(p.totalAssets, Number(p.totalAssets.toFixed(2)))
    }
})

test('equity frontend: millisecond timestamps, duplicate last value, ordered data, empty and Taipei formatting', () => {
    assert.deepEqual(toEquityChartData([]), [])
    const points = [{timestamp:new Date(NOW + 1).toISOString(),totalAssets:101},
        {timestamp:new Date(NOW).toISOString(),totalAssets:100}, {timestamp:new Date(NOW).toISOString(),totalAssets:102}]
    const before = structuredClone(points)
    assert.deepEqual(toEquityChartData(points), [{time:NOW / 1000,value:102},{time:(NOW + 1) / 1000,value:101}])
    assert.deepEqual(points, before)
    assert.match(formatEquityTime(NOW / 1000), /16:00:00/)
    assert.equal(formatEquityChange({change:100,changePercent:1}), '+$100.00 (+1.00%)')
    assert.equal(formatEquityChange({change:-100,changePercent:-1}), '$-100.00 (-1.00%)')
})

for (const mode of ['equity', 'market', 'candles', 'combined']) {
    test('equity startup: ' + mode + ' fixtures do not settle accounts or create private trades', async () => {
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
                    const get = async path => {
                        const r = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path)
                        assert.equal(r.status, 200); return r.json()
                    }
                    const accounts = await get('/accounts')
                    for (const a of accounts) {
                        const h = await get('/accounts/' + a.id + '/equity-history')
                        assert.equal(h.points.length, ${mode === 'equity' || mode === 'combined' ? 'a.id === 1 ? 500 : 1' : '1'})
                        assert.equal(h.points.at(-1).totalAssets, a.totalAssets)
                        assert.equal(h.points.at(-1).cash, a.cash)
                        assert.equal(a.cash, 1000000)
                        assert.equal(a.holdings[0].quantity, 2000)
                        assert.equal(a.holdings[0].averageCost, 94.8)
                        assert.equal(a.realizedPnl, 0)
                        assert.equal((await get('/accounts/' + a.id + '/trades')).items.length, 0)
                    }
                    assert.deepEqual(await get('/orders'), [])
                    ${mode === 'equity' ? "assert.deepEqual(await get('/trades'), []); assert.equal(accounts[0].totalAssets, 1208200)" : ''}
                    assert.deepEqual(await get('/accounts'), accounts)
                } catch (e) { console.error(e); process.exitCode = 1 }
                finally { server.close() }
            })
        `
        await require('node:util').promisify(require('node:child_process').execFile)(process.execPath, ['-e', script], {
            cwd: require('node:path').resolve(__dirname, '..'), timeout: 15000,
            env: { ...process.env, NODE_ENV:'development', NIOUSTOCK_SEED_EQUITY: ['equity','combined'].includes(mode) ? '1' : '',
                NIOUSTOCK_SEED_MARKET: ['market','combined'].includes(mode) ? '1' : '', NIOUSTOCK_SEED_CANDLES: mode === 'candles' ? '1' : '' }
        })
    })
}

test('equity seed: production rejected before server listens', () => {
    const script = `process.env.NODE_ENV='production'; process.env.NIOUSTOCK_SEED_EQUITY='1'; require('node:assert/strict').throws(() => require('./server/index').startServer(), /local development only/)`
    require('node:child_process').execFileSync(process.execPath, ['-e', script], { cwd: require('node:path').resolve(__dirname, '..'), timeout: 5000 })
})

test('equity seed CLI: real entry point starts without circular exports and serves history', async () => {
    // Run the actual CLI as main, redirecting only its listener to an ephemeral
    // port so the regression test never conflicts with a developer's port 3000.
    const script = `
        const assert = require('node:assert/strict')
        const { Server } = require('node:net')
        const listen = Server.prototype.listen
        Server.prototype.listen = function (port, ...args) {
            this.once('listening', async () => {
                try {
                    const response = await fetch('http://127.0.0.1:' + this.address().port + '/api/accounts/1/equity-history?range=1M')
                    assert.equal(response.status, 200)
                    const result = await response.json()
                    assert.equal(result.points.length, 500)
                    assert.equal(result.summary.endValue, 1208200)
                } catch (error) { console.error(error); process.exitCode = 1 }
                finally { this.close() }
            })
            return listen.call(this, 0, ...args)
        }
        process.argv = [process.execPath, require.resolve('./server/seedEquityHistory')]
        require('node:module').runMain()
    `
    await require('node:util').promisify(require('node:child_process').execFile)(process.execPath, ['-e', script], {
        cwd: require('node:path').resolve(__dirname, '..'), timeout: 15000,
        env: { ...process.env, NODE_ENV:'development', NIOUSTOCK_SEED_EQUITY:'', NIOUSTOCK_SEED_MARKET:'', NIOUSTOCK_SEED_CANDLES:'' }
    })
})
