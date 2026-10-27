const { test } = require('node:test')
const assert = require('node:assert/strict')
const candle = (timestamp, close = 100) => ({ timestamp, open: 100, high: 101, low: 99, close, volume: 10, tradeCount: 1 })

test('chart: convert milliseconds to UTC seconds without mutating backend candles', async () => {
    const { toChartCandle } = await import('../src/chartData.mjs')
    const input = candle(1803600000000)
    assert.deepEqual(toChartCandle(input), { time: 1803600000, open: 100, high: 101, low: 99, close: 100 })
    assert.equal(input.timestamp, 1803600000000)
    assert.equal(input.volume, 10)
})
test('chart: same timestamp and appended candles use incremental update', async () => {
    const { chartChange } = await import('../src/chartData.mjs')
    const previous = [candle(1000), candle(2000)]
    assert.equal(chartChange(previous, [candle(1000), candle(2000, 101)]), 'update')
    assert.equal(chartChange(previous, [...previous, candle(3000)]), 'update')
    assert.equal(chartChange(previous, [...previous, candle(3000), candle(4000)]), 'update')
    assert.equal(chartChange(previous, previous), 'update')
})
test('chart: capped frontend history does not require replacing chart series', async () => {
    const { chartChange } = await import('../src/chartData.mjs')
    assert.equal(chartChange([candle(1000), candle(2000), candle(3000)], [candle(2000), candle(3000), candle(4000)]), 'update')
})
test('chart: changed history, older data, empty data and new snapshots replace series', async () => {
    const { chartChange } = await import('../src/chartData.mjs')
    assert.equal(chartChange([], [candle(1000)]), 'replace')
    assert.equal(chartChange([candle(1000)], []), 'replace')
    assert.equal(chartChange([candle(2000)], [candle(1000)]), 'replace')
    assert.equal(chartChange([candle(1000), candle(2000)], [candle(1000, 101), candle(2000)]), 'replace')
})
test('chart: Taipei intraday hours and daily date at UTC day boundary', async () => {
    const { formatChartTime } = await import('../src/chartData.mjs')
    const time = Date.parse('2026-10-26T16:30:00Z') / 1000
    assert.match(formatChartTime(time, '1m', true), /00:30/)
    assert.match(formatChartTime(time, '1d', true), /2026.*10.*27/)
    assert.doesNotMatch(formatChartTime(time, '1d', true), /:/)
    assert.match(formatChartTime(time, '1h'), /2026.*10.*27.*00:30/)
})
test('snapshot: optional candle handler omitted avoids duplicate candle request', async () => {
    const { loadSnapshot } = await import('../src/stockSnapshot.mjs')
    const paths = []
    await loadSnapshot(async path => { paths.push(path); return {} }, 'YT001', '1m', {
        stock: { success: () => {}, failure: () => assert.fail('unexpected') }
    }, () => true)
    assert.deepEqual(paths, ['/stocks/YT001'])
})
