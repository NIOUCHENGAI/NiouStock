const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { stockFlow, marketFlowRankings, marketStats } = require('./market')
const { traderRankings } = require('./traderRankings')
const { createEquityHistory } = require('./equityHistory')
const { EQUITY_RANGES, periodStart } = require('../src/equityHistory.mjs')
const { flowRankings, updateMarket, rankBy } = require('../src/marketHelpers.mjs')
const { createDemoTraders } = require('./rankingsSeed')
const { generateEquityHistory } = require('./equityHistorySeed')
const NOW = Date.parse('2026-10-30T08:00:00Z'), DAY = 86400000

async function market(run) {
    delete require.cache[require.resolve('./index')]
    const server = require('./index').createServer()
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const request = async (path, body) => {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path,
            body ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) } : {})
        return { status:response.status, data:await response.json() }
    }
    const order = (userId, side, price, quantity) => request('/orders', {userId,side,price,quantity,stockCode:'YT001'})
    try { await run({ request, order, server }) } finally { await new Promise(resolve => server.close(resolve)) }
}
const trade = (price, quantity, aggressorSide, createdAt = new Date(NOW).toISOString(), stockCode = 'A') => ({ price, quantity, aggressorSide, createdAt, stockCode })

for (const side of ['buy', 'sell']) {
    test('aggressor: incoming ' + side + ' determines partial execution side at resting price', () => market(async ({ order, request }) => {
        const opposite = side === 'buy' ? 'sell' : 'buy'
        await order(2, opposite, 100, 30)
        const result = await order(1, side, side === 'buy' ? 101 : 99.5, 100)
        assert.equal(result.status, 201)
        assert.equal(result.data.trades.length, 1)
        assert.equal(result.data.trades[0].aggressorSide, side)
        assert.equal(result.data.trades[0].quantity, 30)
        assert.equal(result.data.trades[0].price, 100)
        const flow = (await request('/market/flow/YT001')).data
        assert.equal(flow[side === 'buy' ? 'buyTurnover' : 'sellTurnover'], 3000)
        assert.equal(flow.netFlow, side === 'buy' ? 3000 : -3000)
    }))
}
test('aggressor: multi-level buy marks each execution, never guesses from price', () => market(async ({ order, request }) => {
    await order(2,'sell',100,10); await order(2,'sell',101,20); await order(2,'sell',102,30)
    const result = await order(1,'buy',102,60)
    assert.deepEqual(result.data.trades.map(t => t.aggressorSide), ['buy','buy','buy'])
    const flow = (await request('/market/flow/YT001?period=ALL')).data
    assert.equal(flow.buyTurnover,6080); assert.equal(flow.sellTurnover,0)
    assert.equal(flow.tradeCount,3); assert.equal(flow.volume,60)
}))

test('flow: exact execution amounts, aggressor turnover, ratios, volume and counts', () => {
    const trades = [trade(100,10,'buy'),trade(101,20,'buy'),trade(99,5,'sell'),trade(500,100,'buy',undefined,'B')]
    assert.deepEqual(stockFlow(trades,'A','ALL',NOW), {stockCode:'A',period:'ALL',buyTurnover:3020,sellTurnover:495,netFlow:2525,
        turnover:3515,volume:35,tradeCount:3,buyRatio:85.92,sellRatio:14.08})
    const empty = stockFlow([],'A','ALL',NOW)
    for (const key of ['buyTurnover','sellTurnover','netFlow','turnover','volume','tradeCount','buyRatio','sellRatio']) assert.equal(empty[key],0)
    assert.equal(stockFlow([trade(0.1,3,'buy'),trade(0.05,2,'sell')],'A','ALL',NOW).netFlow,0.2)
})

test('shared helpers: equity invalid-range contract preserved; legacy flow side is not inferred', () => {
    assert.throws(()=>createEquityHistory().read(1,'invalid',NOW), {message:'Invalid range'})
    const flow = stockFlow([trade(100,10,undefined)],'A','ALL',NOW)
    assert.equal(flow.turnover,1000); assert.equal(flow.volume,10); assert.equal(flow.tradeCount,1)
    assert.equal(flow.buyTurnover,0); assert.equal(flow.sellTurnover,0); assert.equal(flow.netFlow,0)
})

for (const [period, days] of [['1D',1],['1W',7],['1M',30],['ALL',60]]) {
    test('flow period ' + period + ': inclusive rolling boundaries and no future data', () => {
        const trades = Array.from({length:62}, (_, i) => trade(1,1,'buy',new Date(NOW - (i - 1) * DAY).toISOString()))
        const flow = stockFlow(trades,'A',period,NOW)
        assert.equal(flow.tradeCount,days + 1)
        assert.equal(flow.netFlow,days + 1)
        if (period !== 'ALL') assert.equal(periodStart(period,NOW),NOW - days * DAY)
    })
}

test('flow: Taipei calendar-day market stats retain their existing boundaries separately from rolling 1D', () => {
    const trades = [trade(100,1,'buy','2026-10-29T15:59:59Z'), trade(100,2,'sell','2026-10-29T16:00:00Z')]
    assert.equal(marketStats(trades,'A',NOW).volume,2)
    assert.equal(stockFlow(trades,'A','1D',NOW).volume,3)
})

test('flow rankings: deterministic inflow, outflow, turnover, top five and shared frontend sorting', () => {
    const stocks = ['A','B','C','D','E','F'].map(code => ({code,name:code}))
    const trades = [trade(10,10,'buy'),trade(10,20,'sell',undefined,'B'),trade(20,10,'buy',undefined,'C')]
    const result = marketFlowRankings(trades,stocks,'ALL',NOW)
    assert.equal(result.inflowLeaders[0].code,'C'); assert.equal(result.outflowLeaders[0].code,'B')
    assert.deepEqual(result.turnoverLeaders.slice(0,2).map(t=>t.code),['B','C'])
    assert.equal(result.inflowLeaders.length,5)
    const flows = stocks.map(s=>({...s,...stockFlow(trades,s.code,'ALL',NOW)}))
    assert.deepEqual(flowRankings(flows), {inflowLeaders:result.inflowLeaders,outflowLeaders:result.outflowLeaders,turnoverLeaders:result.turnoverLeaders})
})

test('trader rankings: assets, returns, realized PnL, deterministic numeric user ties, and empty users', () => {
    const users = [{id:10,name:'Ten',totalAssets:500,realizedPnl:20},{id:2,name:'Two',totalAssets:500,realizedPnl:40},{id:3,name:'Three',totalAssets:900,realizedPnl:-1}]
    const history = createEquityHistory()
    for (const user of users) {
        history.record(user.id,{cash:100,holdingsValue:0},NOW - DAY)
        history.record(user.id,{cash:user.id === 10 ? 120 : 110,holdingsValue:0},NOW)
    }
    const result = traderRankings(users,u=>u,history,'1D',NOW)
    assert.deepEqual(result.assetLeaders.map(u=>u.userId),[3,2,10])
    assert.deepEqual(result.returnLeaders.map(u=>u.userId),[10,2,3])
    assert.deepEqual(result.realizedPnlLeaders.map(u=>u.userId),[2,10,3])
    assert.deepEqual(result.assetLeaders.map(u=>u.rank),[1,2,3])
    assert.equal(result.returnLeaders[0].returnAmount,20)
    assert.equal(result.returnLeaders[0].returnPercent,20)
    assert.deepEqual(traderRankings([],u=>u,history,'ALL',NOW),{period:'ALL',assetLeaders:[],returnLeaders:[],realizedPnlLeaders:[]})
})

test('trader rankings: insufficient history, zero start, negative performance and period changes', () => {
    const users = [1,2,3,4].map(id=>({id,name:String(id),totalAssets:100,realizedPnl:0}))
    const history = createEquityHistory()
    history.record(1,{cash:200,holdingsValue:0},NOW - 6 * DAY)
    history.record(1,{cash:100,holdingsValue:0},NOW)
    history.record(2,{cash:100,holdingsValue:0},NOW - DAY)
    history.record(2,{cash:110,holdingsValue:0},NOW)
    history.record(3,{cash:0,holdingsValue:0},NOW - DAY)
    history.record(3,{cash:50,holdingsValue:0},NOW)
    const daily = traderRankings(users,u=>u,history,'1D',NOW)
    const weekly = traderRankings(users,u=>u,history,'1W',NOW)
    assert.equal(daily.returnLeaders.find(u=>u.userId===1).returnAmount,0)
    assert.equal(weekly.returnLeaders.find(u=>u.userId===1).returnPercent,-50)
    assert.equal(daily.returnLeaders.find(u=>u.userId===3).returnPercent,0)
    assert.equal(daily.returnLeaders.find(u=>u.userId===4).returnAmount,0)
})

test('analytics API: defaults, valid periods, invalid periods 400, missing stock 404; normal mode has two users', () => market(async ({request}) => {
    for (const path of ['/rankings/traders','/market/flow-rankings','/market/flow/YT001']) {
        assert.equal((await request(path)).data.period,'1D')
        for (const period of EQUITY_RANGES) assert.equal((await request(path+'?period='+period)).status,200)
        for (const query of ['period=bad','period=','period=1d','period=1D&period=ALL']) assert.equal((await request(path+'?'+query)).status,400)
    }
    assert.equal((await request('/market/flow/NOPE')).status,404)
    assert.equal((await request('/rankings/traders')).data.assetLeaders.length,2)
}))

test('flow WS: correct stock updates all periods; public payloads never contain account metadata', () => market(async ({request,order,server}) => {
    const {WebSocket} = require('ws')
    const socket = new WebSocket('ws://127.0.0.1:' + server.address().port + '/ws')
    await once(socket,'open')
    const updates = []
    socket.on('message',raw=>updates.push(JSON.parse(raw)))
    const update = new Promise(resolve => socket.on('message',raw=>{const event=JSON.parse(raw); if(event.type==='stock:update') resolve(event)}))
    const other = (await request('/stocks/YT002')).data
    await order(2,'sell',100,10); await order(1,'buy',100,10)
    const event = await update
    assert.equal(event.stockCode,'YT001')
    for (const period of EQUITY_RANGES) assert.equal(event.data.flows[period].netFlow,1000)
    assert.deepEqual((await request('/stocks/YT002')).data,other)
    assert.deepEqual(event.data.flows['1D'],(await request('/market/flow/YT001')).data)
    assert.ok(!JSON.stringify(updates).match(/buyerUserId|sellerUserId|averageCost|realizedPnl/))
    socket.close(); await once(socket,'close')
}))

test('flow frontend: stock update replaces only affected flows, preserving unrelated data and sorting', () => {
    const stocks = [{code:'A',flows:{'1D':{netFlow:1,turnover:1}}},{code:'B',flows:{'1D':{netFlow:2,turnover:2}}}]
    const next = updateMarket(stocks,{code:'A',flows:{'1D':{netFlow:3,turnover:3}}})
    assert.equal(next[1],stocks[1]); assert.equal(stocks[0].flows['1D'].netFlow,1)
    assert.equal(flowRankings(next.map(s=>({code:s.code,...s.flows['1D']}))).inflowLeaders[0].code,'A')
    assert.deepEqual(rankBy([{userId:10,value:1},{userId:2,value:1}],'value',-1,'userId').map(u=>u.userId),[2,10])
})

test('ranking fixtures: deterministic accounts and distinct 1D/1W/1M/ALL returns without account mutation', () => {
    const users = createDemoTraders()
    assert.deepEqual(users,createDemoTraders()); assert.equal(users.length,8)
    const before = structuredClone(users), history = createEquityHistory()
    const valuation = user => ({cash:user.cash,holdingsValue:100000,totalAssets:user.cash + 100000,realizedPnl:Number(user.holdings.YT001.realizedPnlMicros)/1000000})
    for (const user of users) {
        const options = {profile:user.id,days:60}
        const points = generateEquityHistory(user.id,valuation(user),NOW,options)
        assert.deepEqual(points,generateEquityHistory(user.id,valuation(user),NOW,options))
        history.replace(user.id,points)
    }
    const returns = EQUITY_RANGES.map(period => traderRankings(users,valuation,history,period,NOW).returnLeaders)
    assert.equal(new Set(returns.map(rows=>rows.map(u=>u.userId).join(','))).size,4)
    for (const user of users) assert.equal(new Set(returns.map(rows=>rows.find(u=>u.userId===user.id).returnAmount)).size,4)
    assert.deepEqual(users,before)
})

test('market seeds: deterministic legal aggressor sides and zero private trade history', () => {
    const {createStocks} = require('./stockFixtures')
    const {isValidStockPrice,getDailyPriceLimits} = require('./index')
    const {generateMarketTrades} = require('./seedMarket')
    const trades = generateMarketTrades(createStocks(),isValidStockPrice,getDailyPriceLimits,NOW)
    assert.deepEqual(trades,generateMarketTrades(createStocks(),isValidStockPrice,getDailyPriceLimits,NOW))
    for (const t of [...trades,...require('./seedCandles').generateSeedTrades(NOW)]) assert.ok(['buy','sell'].includes(t.aggressorSide))
    assert.ok(trades.some(t=>t.aggressorSide==='buy')); assert.ok(trades.some(t=>t.aggressorSide==='sell'))
    assert.equal(require('./tradeHistory').tradeHistory(trades,createStocks(),1).items.length,0)
})

test('rankings seed CLI: real entry point, 10 users, all periods, flow fixtures, no orders/private trades', async () => {
    const script = `
        const assert = require('node:assert/strict')
        const { Server } = require('node:net'), listen = Server.prototype.listen
        Server.prototype.listen = function (port, ...args) {
            this.once('listening', async () => {
                try {
                    assert.equal(this.address().address,'127.0.0.1')
                    const get = async path => { const r=await fetch('http://127.0.0.1:'+this.address().port+'/api'+path); assert.equal(r.status,200); return r.json() }
                    for(const period of ['1D','1W','1M','ALL']) assert.equal((await get('/rankings/traders?period='+period)).assetLeaders.length,10)
                    const account = await get('/accounts/1')
                    assert.equal(account.cash,1000000); assert.equal(account.holdings[0].quantity,2000); assert.equal(account.holdings[0].averageCost,94.8); assert.equal(account.realizedPnl,0)
                    for(const user of await get('/accounts')) assert.equal((await get('/accounts/'+user.id+'/trades')).items.length,0)
                    assert.deepEqual(await get('/orders'),[])
                    assert.ok((await get('/market/flow-rankings')).turnoverLeaders[0].turnover>0)
                } catch(error) { console.error(error); process.exitCode=1 }
                finally { this.close() }
            })
            return listen.call(this,0,...args)
        }
        process.argv=[process.execPath,require.resolve('./server/seedRankings')]
        require('node:module').runMain()
    `
    await require('node:util').promisify(require('node:child_process').execFile)(process.execPath,['-e',script],{
        cwd:require('node:path').resolve(__dirname,'..'),timeout:15000,
        env:{...process.env,NODE_ENV:'development',NIOUSTOCK_SEED_MARKET:'',NIOUSTOCK_SEED_CANDLES:'',NIOUSTOCK_SEED_EQUITY:'',NIOUSTOCK_SEED_RANKINGS:''}
    })
})

test('rankings seed: production rejects before listening', () => {
    require('node:child_process').execFileSync(process.execPath,['-e',`process.env.NODE_ENV='production';process.env.NIOUSTOCK_SEED_RANKINGS='1';require('node:assert/strict').throws(()=>require('./server/index').startServer(),/local development only/)`],{
        cwd:require('node:path').resolve(__dirname,'..'),timeout:5000
    })
})
