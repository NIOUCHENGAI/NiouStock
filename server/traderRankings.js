const { periodStart } = require('../src/equityHistory.mjs')
const { rankBy } = require('../src/marketHelpers.mjs')

function traderRankings(users, valueAccount, equityHistory, period = '1D', now = Date.now()) {
    periodStart(period, now)
    const traders = users.map(user => {
        const account = valueAccount(user)
        const history = equityHistory.read(user.id, period, now)
        return { userId: user.id, name: user.name, totalAssets: account.totalAssets,
            returnAmount: history.summary.change, returnPercent: history.summary.changePercent, realizedPnl: account.realizedPnl }
    })
    const ranked = key => rankBy(traders, key, -1, 'userId').map((trader, i) => ({ ...trader, rank: i + 1 }))
    return { period, assetLeaders: ranked('totalAssets'), returnLeaders: ranked('returnPercent'), realizedPnlLeaders: ranked('realizedPnl') }
}
module.exports = { traderRankings }
