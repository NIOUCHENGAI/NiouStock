const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const keys = ['stock', 'book', 'trades', 'account', 'orders', 'candles']
for (const failed of keys) {
    test('snapshot: isolated ' + failed + ' failure preserves all other regions', async () => {
        const { loadSnapshot } = await import('../src/stockSnapshot.mjs')
        const success = [], errors = [], paths = []
        const handlers = Object.fromEntries(keys.map(key => [key, {
            success: () => success.push(key), failure: error => errors.push([key, error.message])
        }]))
        const pathFor = { stock: '/stocks/', book: '/orderbook/', trades: '/trades/', account: '/account', orders: '/orders', candles: '/candles/' }
        await loadSnapshot(async path => {
            paths.push(path)
            if (path.startsWith(pathFor[failed])) throw new Error(path + ': HTTP 404 Not Found')
            return []
        }, 'YT001', '1m', handlers, () => true)
        assert.deepEqual(success.sort(), keys.filter(key => key !== failed).sort())
        assert.equal(errors.length, 1)
        assert.equal(errors[0][0], failed)
        assert.match(errors[0][1], /HTTP 404/)
        assert.ok(paths.includes('/candles/YT001?interval=1m&limit=100'))
    })
}
test('snapshot: stock renders before slow optional request completes; ignores disposed results', async () => {
    const { loadSnapshot } = await import('../src/stockSnapshot.mjs')
    let release, current = true
    const pending = new Promise(resolve => { release = resolve })
    const commits = []
    const handlers = Object.fromEntries(keys.map(key => [key, { success: () => commits.push(key), failure: () => assert.fail('unexpected error') }]))
    const work = loadSnapshot(path => path.startsWith('/candles/') ? pending : Promise.resolve([]), 'YT001', '1m', handlers, () => current)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(commits.includes('stock'))
    assert.ok(!commits.includes('candles'))
    current = false
    release([])
    await work
    assert.ok(!commits.includes('candles'))
})
test('HTTP: current source serves every initial snapshot API including candles', async () => {
    const { createServer } = require('./index')
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
        for (const path of ['/stocks/YT001', '/account', '/orders', '/orders?userId=1', '/trades/YT001', '/orderbook/YT001', '/candles/YT001?interval=1m&limit=100']) {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path)
            assert.equal(response.status, 200, path)
            assert.match(response.headers.get('content-type'), /application.json/)
            await response.json()
        }
    } finally { await new Promise(resolve => server.close(resolve)) }
})
test('readApi: retains HTTP status and endpoint; base URLs remain localhost:3000', async () => {
    const { API_BASE, WS_URL, readApi } = await import('../src/stockSnapshot.mjs')
    assert.equal(API_BASE, 'http://localhost:3000/api')
    assert.equal(WS_URL, 'ws://localhost:3000/ws')
    const original = global.fetch
    try {
        global.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' })
        await assert.rejects(readApi('/candles/YT001'), error => error.message === '/candles/YT001: HTTP 404 Not Found')
    } finally { global.fetch = original }
})
