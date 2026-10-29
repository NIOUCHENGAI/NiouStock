const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHolding, buyHolding, sellHolding, publicHolding, valuePosition, summarizePositions, revaluePortfolio } = require('../src/portfolioMath.mjs')
const stock = { code: 'A', name: 'Alpha', category: 'YouTube', price: 110, previousClose: 100 }
const position = (quantity = 200, averageCost = 100, realizedPnl = 0) => ({ stockCode: 'A', quantity, averageCost, realizedPnl, availableQuantity: quantity, reservedQuantity: 0 })
test('cost A: single buy uses moving weighted average', () => {
    const h = createHolding(100, 90); buyHolding(h,100,110)
    assert.deepEqual(publicHolding(h), { quantity: 200, averageCost: 100, realizedPnl: 0 })
})
test('cost B: partial profit sale preserves remaining average', () => {
    const h = createHolding(200,100); sellHolding(h,50,110)
    assert.deepEqual(publicHolding(h), { quantity: 150, averageCost: 100, realizedPnl: 500 })
})
test('cost C: loss sale records negative realized PnL', () => {
    const h = createHolding(200,100); sellHolding(h,50,90)
    assert.equal(publicHolding(h).realizedPnl,-500)
})
test('cost D: multi-level buys are weighted per actual fill', () => {
    const h = createHolding()
    for (const price of [100,101,102]) buyHolding(h,10,price)
    assert.deepEqual(publicHolding(h), { quantity: 30, averageCost: 101, realizedPnl: 0 })
})
test('cost E: full exit resets cost, reentry preserves realized PnL', () => {
    const h = createHolding(200,100); sellHolding(h,200,110)
    assert.deepEqual(publicHolding(h), { quantity: 0, averageCost: 0, realizedPnl: 2000 })
    buyHolding(h,50,120)
    assert.deepEqual(publicHolding(h), { quantity: 50, averageCost: 120, realizedPnl: 2000 })
})
test('precision: fractional average retains six decimal places without cent-rounding drift', () => {
    const h = createHolding(1,99.9); buyHolding(h,2,100)
    assert.equal(publicHolding(h).averageCost,99.966667)
    sellHolding(h,3,100)
    assert.equal(publicHolding(h).realizedPnl,0.10)
    assert.equal(h.quantity,0)
})
test('portfolio: cost, market value, unrealized/today PnL and percentages', () => {
    const p = valuePosition(position(),stock)
    assert.equal(p.costBasis,20000); assert.equal(p.marketValue,22000)
    assert.equal(p.unrealizedPnl,2000); assert.equal(p.unrealizedPnlPercent,10)
    assert.equal(p.todayPnl,2000); assert.equal(p.todayPnlPercent,10)
})
test('portfolio: zero quantity/cost/previous close are safe', () => {
    const p = valuePosition(position(0,0,100),{...stock,previousClose:0})
    for (const key of ['costBasis','marketValue','unrealizedPnl','unrealizedPnlPercent','todayPnl','todayPnlPercent']) assert.equal(p[key],0)
    assert.equal(p.realizedPnl,100)
    assert.equal(valuePosition(position(10,0),stock).unrealizedPnlPercent,0)
    assert.equal(valuePosition(position(),{...stock,previousClose:0}).todayPnlPercent,0)
})
test('portfolio summary: multiple stocks, closed realized positions, reservations and empty account', () => {
    const positions = [valuePosition(position(),stock),valuePosition({...position(0,0,500),stockCode:'B'},stock)]
    const summary = summarizePositions(10000,1000,positions)
    assert.equal(summary.totalAssets,32000); assert.equal(summary.availableCash,9000)
    assert.equal(summary.realizedPnl,500); assert.equal(summary.costBasis,20000)
    assert.equal(summarizePositions(100,0,[]).totalAssets,100)
    assert.equal(summarizePositions(100,0,[]).unrealizedPnl,0)
})
test('public stock revaluation updates only matching position and preserves private balances', () => {
    const a=valuePosition(position(),stock), b=valuePosition({...position(5,100),stockCode:'B'},stock)
    const portfolio={user:{id:1},positions:[a,b],summary:{...summarizePositions(1000,100,[a,b]),realizedPnl:555}}
    const next=revaluePortfolio(portfolio,{...stock,price:120})
    assert.equal(next.positions[1],b)
    assert.equal(next.positions[0].quantity,200)
    assert.equal(next.positions[0].averageCost,100)
    assert.equal(next.positions[0].marketValue,24000)
    assert.equal(next.positions[0].todayPnl,4000)
    assert.equal(next.summary.totalAssets,25550)
    assert.equal(next.summary.realizedPnl,555)
    assert.equal(next.summary.cash,1000); assert.equal(next.summary.reservedCash,100)
    assert.equal(portfolio.positions[0].price,110)
})
async function market(run) {
    delete require.cache[require.resolve('./index')]
    const server=require('./index').createServer()
    server.listen(0,'127.0.0.1'); await require('node:events').once(server,'listening')
    const request=async(path,method='GET',body)=>{
        const response=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)})
        return {status:response.status,data:await response.json()}
    }
    const order=(userId,side,price,quantity,stockCode='YT001')=>request('/orders','POST',{userId,side,price,quantity,stockCode})
    try {await run({request,order})} finally {await new Promise(resolve=>server.close(resolve))}
}
test('HTTP F/G: partial fill uses resting price; pending and cancelled reservations never change cost',()=>market(async({request,order})=>{
    const before=(await request('/accounts/1')).data
    const pending=(await order(1,'buy',101,100)).data.order
    let account=(await request('/accounts/1')).data
    assert.equal(account.holdings[0].averageCost,94.8)
    await order(2,'sell',100,40)
    account=(await request('/accounts/1')).data
    assert.equal(account.holdings[0].averageCost,Number(((2000*94.8+40*101)/2040).toFixed(6)))
    assert.equal(account.holdings[0].quantity,2040)
    assert.equal(account.reservedCash,6060)
    const cost=account.holdings[0].averageCost
    await request('/orders/'+pending.id+'?userId=1','DELETE')
    const sell=(await order(1,'sell',102,10)).data.order
    await request('/orders/'+sell.id+'?userId=1','DELETE')
    account=(await request('/accounts/1')).data
    assert.equal(account.holdings[0].averageCost,cost)
    assert.equal(account.realizedPnl,before.realizedPnl)
    const seller=(await request('/accounts/2')).data
    assert.equal(seller.holdings[0].realizedPnl,248)
    assert.equal(account.cash+seller.cash,2000000)
    assert.equal(account.holdings[0].quantity+seller.holdings[0].quantity,4000)
}))
test('HTTP: multi-level cost follows actual trade prices with unchanged cash settlement',()=>market(async({request,order})=>{
    await order(2,'sell',100,10);await order(2,'sell',101,10);await order(2,'sell',102,10)
    await order(1,'buy',103,30)
    const account=(await request('/account')).data
    assert.equal(account.holdings[0].averageCost,Number(((2000*94.8+3030)/2030).toFixed(6)))
    assert.equal(account.cash,996970)
    assert.deepEqual(account.summary,(await request('/portfolio/1')).data.summary)
    assert.equal((await request('/portfolio/999')).status,404)
}))
test('HTTP: closed positions disappear from portfolio but realized PnL survives reentry',()=>market(async({request,order})=>{
    await order(1,'buy',25,150,'KO001');await order(2,'sell',25,150,'KO001')
    let account=(await request('/accounts/2')).data
    const closed=account.holdings.find(h=>h.stockCode==='KO001')
    assert.equal(closed.quantity,0);assert.equal(closed.averageCost,0);assert.equal(closed.realizedPnl,-150)
    let portfolio=(await request('/portfolio/2')).data
    assert.ok(!portfolio.positions.some(p=>p.stockCode==='KO001'))
    assert.equal(portfolio.summary.realizedPnl,-150)
    await order(1,'sell',25.5,50,'KO001');await order(2,'buy',25.5,50,'KO001')
    account=(await request('/accounts/2')).data
    const reopened=account.holdings.find(h=>h.stockCode==='KO001')
    assert.equal(reopened.averageCost,25.5);assert.equal(reopened.realizedPnl,-150)
    assert.equal(account.cash+(await request('/accounts/1')).data.cash,2000000)
}))
