const { periodStart } = require('../src/equityHistory.mjs')
const MAX_POINTS = 500
const cents = value => BigInt(Math.round(value * 100))
const decimal = value => Number(value) / 100

function createEquityHistory() {
    const histories = new Map()
    let nextId = 1
    function record(userId, valuation, now = Date.now()) {
        const history = histories.get(userId) || []
        const cash = decimal(cents(valuation.cash)), holdingsValue = decimal(cents(valuation.holdingsValue))
        const totalAssets = decimal(cents(cash) + cents(holdingsValue))
        const last = history.at(-1)
        if (last && last.cash === cash && last.holdingsValue === holdingsValue && last.totalAssets === totalAssets) return false
        // Keep event order even if the wall clock moves backwards. Equal timestamps are valid.
        const timestamp = new Date(Math.max(now, last ? Date.parse(last.timestamp) : -Infinity)).toISOString()
        history.push({ id: nextId++, userId, timestamp, cash, holdingsValue, totalAssets })
        histories.set(userId, history)
        return true
    }
    function replace(userId, points) {
        histories.delete(userId)
        for (const point of points) record(userId, point, Date.parse(point.timestamp))
    }
    function read(userId, range = 'ALL', now = Date.now()) {
        const from = periodStart(range, now, 'range')
        const filtered = (histories.get(userId) || []).filter(point => {
            const time = Date.parse(point.timestamp)
            return time >= from && time <= now
        })
        const start = cents(filtered[0]?.totalAssets || 0), end = cents(filtered.at(-1)?.totalAssets || 0)
        const change = end - start
        let high = start, low = start
        for (const point of filtered) {
            const value = cents(point.totalAssets)
            if (value > high) high = value
            if (value < low) low = value
        }
        // Summary uses all selected snapshots, before evenly spaced sampling.
        const selected = filtered.length <= MAX_POINTS ? filtered : Array.from({ length: MAX_POINTS }, (_, i) =>
            filtered[Math.floor(i * (filtered.length - 1) / (MAX_POINTS - 1))])
        return { userId, range, points: selected.map(point => ({ ...point })), summary: {
            startValue: decimal(start), endValue: decimal(end), change: decimal(change),
            changePercent: start === 0n ? 0 : Number((Number(change) / Number(start) * 100).toFixed(2)),
            high: decimal(high), low: decimal(low)
        } }
    }
    return { record, read, replace }
}

function recordAffectedEquity(history, users, stockCode, participants, priceChanged, valueAccount, now) {
    for (const user of users) {
        if (participants.has(user.id) || (priceChanged && user.holdings[stockCode]?.quantity > 0)) {
            history.record(user.id, valueAccount(user), now)
        }
    }
}
module.exports = { createEquityHistory, recordAffectedEquity, MAX_POINTS }
