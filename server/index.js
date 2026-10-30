const express = require('express')
const cors = require('cors')
const http = require('node:http')
const { WebSocketServer, WebSocket } = require('ws')
const { intervals, aggregateCandles } = require('./candles')
const { getTickCents, getTickSize, isValidStockPrice, getDailyPriceLimits } = require('../src/stockPrices.mjs')

const { marketStats, rankStocks, stockFlow, marketFlowRankings } = require('./market')
const { traderRankings } = require('./traderRankings')
const { EQUITY_RANGES } = require('../src/equityHistory.mjs')
const { createStocks } = require('./stockFixtures')
const { tradeHistory, money } = require('./tradeHistory')
const { createEquityHistory, recordAffectedEquity } = require('./equityHistory')

const { createHolding, buyHolding, sellHolding, valuePosition, summarizePositions, publicHolding } = require('../src/portfolioMath.mjs')

const app = express()
const PORT = 3000

function createServer() {
    const server = http.createServer(app)
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 })
    const broadcast = event => {
        const payload = JSON.stringify(event)
        for (const client of wss.clients) {
            if (client.readyState !== WebSocket.OPEN) continue
            if (client.bufferedAmount > 1024 * 1024) client.terminate()
            else client.send(payload)
        }
    }
    app.on('market', broadcast)
    wss.on('connection', client => client.on('error', () => {}))
    const close = server.close.bind(server)
    server.close = callback => {
        app.off('market', broadcast)
        for (const client of wss.clients) client.terminate()
        wss.close()
        return close(callback)
    }
    return server
}
function publish(type, stockCode, data) {
    app.emit('market', { type, stockCode, data })
}
function publicTrade({ id, stockCode, price, quantity, createdAt }) {
    return { id, stockCode, price, quantity, createdAt }
}

app.use(cors())
app.use(express.json())

const stocks = createStocks()

const users = [
    {
        id: 1,
        name: 'Test User',
        cash: 1000000,
        holdings: {
            YT001: createHolding(2000, 94.8), YT002: createHolding(100, 48), VT001: createHolding(80, 38)
        }
    },
    {
        id: 2,
        name: 'Test User 2',
        cash: 1000000,
        holdings: {
            YT001: createHolding(2000, 94.8), TW003: createHolding(120, 115), KO001: createHolding(150, 26)
        }
    }
]

const orders = []
const trades = []
const equityHistory = createEquityHistory()
const initializedAt = Date.now()
for (const user of users) equityHistory.record(user.id, getAccountData(user), initializedAt)

function getStockData(stock) {
    const {
        limitUp,
        limitDown
    } = getDailyPriceLimits(stock)

    const now = Date.now()
    return {
        ...stock,
        ...marketStats(trades, stock.code, now),
        flows: Object.fromEntries(EQUITY_RANGES.map(period => [period, stockFlow(trades, stock.code, period, now)])),
        limitUp,
        limitDown,
        tickSize: getTickSize(stock.price)
    }
}

function getAccountData(user) {
    // Derive reservations from open remainders, so fills/cancellations release them automatically.
    const reservedCashCents = orders
        .filter(order => order.userId === user.id && order.side === 'buy' && isOrderOpen(order))
        .reduce((sum, order) => sum + Math.round(order.price * 100) * order.remainingQuantity, 0)
    const holdings = Object.entries(user.holdings).map(([stockCode, holding]) => {
        const stock = stocks.find(item => item.code === stockCode)
        const reservedQuantity = orders
            .filter(order => order.userId === user.id && order.stockCode === stockCode && order.side === 'sell' && isOrderOpen(order))
            .reduce((sum, order) => sum + order.remainingQuantity, 0)
        return valuePosition({ stockCode, ...publicHolding(holding),
            availableQuantity: holding.quantity - reservedQuantity, reservedQuantity },
            stock || { price: 0, previousClose: 0, name: stockCode, category: '' })
    })
    const summary = summarizePositions(user.cash, reservedCashCents / 100, holdings)
    return { id: user.id, name: user.name, ...summary, holdings, summary }
}

function getPortfolio(user) {
    const account = getAccountData(user)
    return { user: { id: user.id, name: user.name }, summary: account.summary,
        positions: account.holdings.filter(holding => holding.quantity > 0) }
}

function isOrderOpen(order) {
    return (
        order.status === 'pending' ||
        order.status === 'partially_filled'
    )
}

function updateOrderStatus(order) {
    if (order.remainingQuantity === 0) {
        order.status = 'filled'
    } else if (
        order.remainingQuantity < order.quantity
    ) {
        order.status = 'partially_filled'
    } else {
        order.status = 'pending'
    }
}

function findMatchingOrder(newOrder) {
    const candidates = orders.filter(order => {
        if (order.id === newOrder.id) {
            return false
        }

        if (order.stockCode !== newOrder.stockCode) {
            return false
        }

        if (!isOrderOpen(order)) {
            return false
        }

        if (order.side === newOrder.side) {
            return false
        }

        if (newOrder.side === 'buy') {
            return order.price <= newOrder.price
        }

        return order.price >= newOrder.price
    })

    if (newOrder.side === 'buy') {
        candidates.sort((a, b) => {
            if (a.price !== b.price) {
                return a.price - b.price
            }

            return a.id - b.id
        })
    } else {
        candidates.sort((a, b) => {
            if (a.price !== b.price) {
                return b.price - a.price
            }

            return a.id - b.id
        })
    }

    return candidates[0] || null
}

function updateStockPrice(stock, price) {
    stock.price = price

    stock.change = Number(
        (
            stock.price -
            stock.previousClose
        ).toFixed(2)
    )

    stock.changePercent = Number(
        (
            (
                stock.change /
                stock.previousClose
            ) *
            100
        ).toFixed(2)
    )
}

function executeMatches(newOrder, stock) {
    const completedTrades = []

    while (newOrder.remainingQuantity > 0) {
        const matchingOrder =
            findMatchingOrder(newOrder)

        if (!matchingOrder) {
            break
        }

        const tradeQuantity = Math.min(
            newOrder.remainingQuantity,
            matchingOrder.remainingQuantity
        )

        const tradePrice =
            matchingOrder.price

        const buyOrder = newOrder.side === 'buy' ? newOrder : matchingOrder
        const sellOrder = newOrder.side === 'sell' ? newOrder : matchingOrder
        const buyer = users.find(user => user.id === buyOrder.userId)
        const seller = users.find(user => user.id === sellOrder.userId)
        const amountCents = Math.round(tradePrice * 100) * tradeQuantity
        buyer.cash = (Math.round(buyer.cash * 100) - amountCents) / 100
        seller.cash = (Math.round(seller.cash * 100) + amountCents) / 100
        const bought = buyer.holdings[stock.code] ||= createHolding()
        const sellerAverageCostAtTrade = Number(seller.holdings[stock.code].averageCostMicros) / 1000000
        const sellerRealizedPnlMicros = (BigInt(Math.round(tradePrice * 1000000)) - seller.holdings[stock.code].averageCostMicros) * BigInt(tradeQuantity)
        const buyerAverageCostBefore = publicHolding(bought).averageCost
        buyHolding(bought, tradeQuantity, tradePrice)
        sellHolding(seller.holdings[stock.code], tradeQuantity, tradePrice)

        newOrder.remainingQuantity -=
            tradeQuantity

        matchingOrder.remainingQuantity -=
            tradeQuantity

        updateOrderStatus(newOrder)
        updateOrderStatus(matchingOrder)

        const trade = {
            aggressorSide: newOrder.side,
            sellerAverageCostAtTrade,
            sellerRealizedPnlMicros,
            sellerRealizedPnl: money(sellerRealizedPnlMicros),
            buyerAverageCostBefore,
            buyerAverageCostAfter: publicHolding(bought).averageCost,
            id: trades.length + 1,
            stockCode: newOrder.stockCode,
            price: tradePrice,
            quantity: tradeQuantity,
            buyOrderId:
                newOrder.side === 'buy'
                    ? newOrder.id
                    : matchingOrder.id,
            sellOrderId:
                newOrder.side === 'sell'
                    ? newOrder.id
                    : matchingOrder.id,
            buyerUserId:
                newOrder.side === 'buy'
                    ? newOrder.userId
                    : matchingOrder.userId,
            sellerUserId:
                newOrder.side === 'sell'
                    ? newOrder.userId
                    : matchingOrder.userId,
            createdAt:
                new Date().toISOString()
        }

        trades.push(trade)
        completedTrades.push(trade)

        const priceChanged = stock.price !== tradePrice
        updateStockPrice(
            stock,
            tradePrice
        )
        recordAffectedEquity(equityHistory, users, stock.code, new Set([buyer.id, seller.id]),
            priceChanged, getAccountData, Date.parse(trade.createdAt))
        publish('trade:new', stock.code, publicTrade(trade))
        publish('stock:update', stock.code, getStockData(stock))
        const stockTrades = trades.filter(t => t.stockCode === stock.code)
        for (const interval of Object.keys(intervals)) {
            const candle = aggregateCandles(stockTrades, interval).at(-1)
            publish('candle:update', stock.code, { stockCode: stock.code, interval, candle })
        }
    }

    updateOrderStatus(newOrder)

    return completedTrades
}

function buildOrderBook(stockCode) {
    const openOrders = orders.filter(order => {
        return (
            order.stockCode === stockCode &&
            isOrderOpen(order) &&
            order.remainingQuantity > 0
        )
    })

    const buyMap = new Map()
    const sellMap = new Map()

    openOrders.forEach(order => {
        const targetMap =
            order.side === 'buy'
                ? buyMap
                : sellMap

        const currentQuantity =
            targetMap.get(order.price) || 0

        targetMap.set(
            order.price,
            currentQuantity +
                order.remainingQuantity
        )
    })

    const buys =
        Array.from(buyMap.entries())
            .map(([price, quantity]) => ({
                price,
                quantity
            }))
            .sort(
                (a, b) =>
                    b.price - a.price
            )

    const sells =
        Array.from(sellMap.entries())
            .map(([price, quantity]) => ({
                price,
                quantity
            }))
            .sort(
                (a, b) =>
                    a.price - b.price
            )

    return {
        stockCode,
        buys,
        sells
    }
}

app.get('/api', (req, res) => {
    res.json({
        message: 'NiouStock API 正常運作'
    })
})

app.get('/api/account', (req, res) => {
    const user = users[0]

    res.json(
        getAccountData(user)
    )
})

app.get('/api/portfolio/:userId', (req, res) => {
    const user = users.find(item => item.id === Number(req.params.userId))
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json(getPortfolio(user))
})

app.get('/api/accounts', (req, res) => res.json(users.map(getAccountData)))

app.get('/api/accounts/:userId/equity-history', (req, res) => {
    const user = users.find(item => item.id === Number(req.params.userId))
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (Object.keys(req.query).some(key => key !== 'range')) return res.status(400).json({ message: 'Invalid query parameter' })
    try { res.json(equityHistory.read(user.id, req.query.range)) }
    catch (error) { res.status(400).json({ message: error.message }) }
})

app.get('/api/accounts/:userId/trades', (req, res) => {
    const user = users.find(item => item.id === Number(req.params.userId))
    if (!user) return res.status(404).json({ message: 'User not found' })
    try { res.json(tradeHistory(trades, stocks, user.id, req.query)) }
    catch (error) { res.status(400).json({ message: error.message }) }
})

app.get('/api/accounts/:id', (req, res) => {
    const user = users.find(user => user.id === Number(req.params.id))
    if (!user) return res.status(404).json({ message: '找不到這個使用者' })
    res.json(getAccountData(user))
})

app.get('/api/market/rankings', (req, res) => res.json(rankStocks(stocks.map(getStockData))))

app.get('/api/rankings/traders', (req, res) => {
    try { res.json(traderRankings(users, getAccountData, equityHistory, req.query.period)) }
    catch (error) { res.status(400).json({ message: error.message }) }
})

app.get('/api/market/flow-rankings', (req, res) => {
    try { res.json(marketFlowRankings(trades, stocks, req.query.period)) }
    catch (error) { res.status(400).json({ message: error.message }) }
})

app.get('/api/market/flow/:code', (req, res) => {
    if (!stocks.some(stock => stock.code === req.params.code)) return res.status(404).json({ message: 'Stock not found' })
    try { res.json(stockFlow(trades, req.params.code, req.query.period)) }
    catch (error) { res.status(400).json({ message: error.message }) }
})

app.get('/api/stocks', (req, res) => {
    res.json(
        stocks.map(stock =>
            getStockData(stock)
        )
    )
})

app.get('/api/stocks/:code', (req, res) => {
    const stock = stocks.find(
        item =>
            item.code === req.params.code
    )

    if (!stock) {
        return res.status(404).json({
            message: '找不到這支股票'
        })
    }

    res.json(
        getStockData(stock)
    )
})

app.get('/api/orders', (req, res) => {
    const userId = Number(req.query.userId || 1)
    res.json(orders.filter(order => order.userId === userId))
})

app.get('/api/candles/:code', (req, res) => {
    if (!stocks.some(stock => stock.code === req.params.code)) return res.status(404).json({ message: 'Stock not found' })
    const interval = req.query.interval === undefined ? '1m' : req.query.interval
    const rawLimit = req.query.limit === undefined ? '100' : req.query.limit
    if (typeof interval !== 'string' || !Object.hasOwn(intervals, interval)) return res.status(400).json({ message: 'Invalid interval' })
    if (typeof rawLimit !== 'string' || !/^[0-9]+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1 || Number(rawLimit) > 500) return res.status(400).json({ message: 'Limit must be an integer from 1 to 500' })
    res.json(aggregateCandles(trades.filter(t => t.stockCode === req.params.code), interval).slice(-Number(rawLimit)))
})

app.get('/api/trades', (req, res) => {
    res.json(trades.map(publicTrade))
})

app.get('/api/trades/:code', (req, res) => {
    const stock = stocks.find(
        item =>
            item.code === req.params.code
    )

    if (!stock) {
        return res.status(404).json({
            message: '找不到這支股票'
        })
    }

    const stockTrades = trades
        .filter(
            trade =>
                trade.stockCode ===
                req.params.code
        )
        .sort((a, b) => {
            return (
                new Date(b.createdAt) -
                new Date(a.createdAt)
            )
        })

    res.json(stockTrades.map(publicTrade))
})

app.get('/api/orderbook/:code', (req, res) => {
    const stock = stocks.find(
        item =>
            item.code === req.params.code
    )

    if (!stock) {
        return res.status(404).json({
            message: '找不到這支股票'
        })
    }

    const orderBook =
        buildOrderBook(req.params.code)

    res.json(orderBook)
})

app.post('/api/orders', (req, res) => {
    const {
        stockCode,
        side,
        price,
        quantity,
        userId = 1
    } = req.body

    const user = users.find(
        item =>
            item.id === Number(userId)
    )

    if (!user) {
        return res.status(404).json({
            message: '找不到這個使用者'
        })
    }

    const stock = stocks.find(
        item => item.code === stockCode
    )

    if (!stock) {
        return res.status(404).json({
            message: '找不到這支股票'
        })
    }

    if (
        side !== 'buy' &&
        side !== 'sell'
    ) {
        return res.status(400).json({
            message: '訂單方向錯誤'
        })
    }

    let orderPrice = Number(price)
    const orderQuantity =
        Number(quantity)

    if (
        !Number.isFinite(orderPrice) ||
        orderPrice <= 0
    ) {
        return res.status(400).json({
            message: '價格必須大於 0'
        })
    }

    if (
        !Number.isFinite(orderQuantity) ||
        orderQuantity <= 0
    ) {
        return res.status(400).json({
            message: '數量必須大於 0'
        })
    }

    if (!Number.isSafeInteger(orderQuantity)) {
        return res.status(400).json({
            message: '股數必須是整數'
        })
    }

    if (
        !isValidStockPrice(orderPrice)
    ) {
        return res.status(400).json({
            message:
                `委託價格不符合台股升降單位，目前此價格的升降單位為 ${getTickSize(orderPrice)} 元`,
            tickSize:
                getTickSize(orderPrice)
        })
    }

    // Normalize immediately after validation; no downstream logic sees the raw input.
    const orderPriceCents = Math.round(orderPrice * 100)
    orderPrice = orderPriceCents / 100

    const {
        limitUp,
        limitDown
    } = getDailyPriceLimits(stock)

    if (
        orderPrice > limitUp ||
        orderPrice < limitDown
    ) {
        return res.status(400).json({
            message:
                `委託價格必須介於 ${limitDown.toFixed(2)} 與 ${limitUp.toFixed(2)} 之間`,
            limitDown,
            limitUp
        })
    }

    const crossesOwnOrder = orders.some(order =>
        order.userId === user.id && order.stockCode === stockCode &&
        order.side !== side && isOrderOpen(order) && order.remainingQuantity > 0 &&
        (side === 'buy' ? order.price <= orderPrice : order.price >= orderPrice)
    )
    if (crossesOwnOrder) {
        return res.status(400).json({ message: '新訂單會與你自己的反向掛單交叉，請先取消原掛單' })
    }

    const account = getAccountData(user)
    const requiredCents = orderPriceCents * orderQuantity
    if (!Number.isSafeInteger(requiredCents)) {
        return res.status(400).json({ message: '訂單金額超出安全範圍' })
    }
    if (side === 'buy' && requiredCents > Math.round(account.availableCash * 100)) {
        return res.status(400).json({ message: `可用現金不足，目前可用 ${account.availableCash.toFixed(2)}` })
    }
    const holding = account.holdings.find(holding => holding.stockCode === stockCode)
    if (side === 'sell' && orderQuantity > (holding?.availableQuantity || 0)) {
        return res.status(400).json({ message: `可用持股不足，目前可用 ${holding?.availableQuantity || 0} 股` })
    }

    const order = {
        id: orders.length + 1,
        userId: user.id,
        stockCode,
        side,
        price: orderPrice,
        quantity: orderQuantity,
        remainingQuantity:
            orderQuantity,
        status: 'pending',
        createdAt:
            new Date().toISOString()
    }

    orders.push(order)

    const completedTrades =
        executeMatches(
            order,
            stock
        )

    publish('orderbook:update', stockCode, buildOrderBook(stockCode))

    res.status(201).json({
        message:
            completedTrades.length > 0
                ? '訂單建立成功並產生成交'
                : '訂單建立成功，目前沒有成交',
        order,
        trades: completedTrades.map(({ sellerRealizedPnlMicros, ...trade }) => trade)
    })
})

app.delete('/api/orders/:id', (req, res) => {
    const orderId =
        Number(req.params.id)

    const order = orders.find(
        item => item.id === orderId
    )

    if (!order) {
        return res.status(404).json({
            message: '找不到這筆訂單'
        })
    }

    if (order.userId !== Number(req.query.userId || 1)) {
        return res.status(403).json({ message: '只能取消自己的訂單' })
    }

    if (!isOrderOpen(order)) {
        return res.status(400).json({
            message:
                '這筆訂單目前無法取消'
        })
    }

    order.status = 'cancelled'
    publish('orderbook:update', order.stockCode, buildOrderBook(order.stockCode))

    res.json({
        message: '訂單取消成功',
        order
    })
})

function startServer() {
    const marketSeeded = process.env.NIOUSTOCK_SEED_MARKET === '1'
    const candleSeeded = process.env.NIOUSTOCK_SEED_CANDLES === '1'
    const equitySeeded = process.env.NIOUSTOCK_SEED_EQUITY === '1'
    const rankingsSeeded = process.env.NIOUSTOCK_SEED_RANKINGS === '1'
    const seeded = marketSeeded || candleSeeded || equitySeeded || rankingsSeeded
    if (seeded && process.env.NODE_ENV === 'production') {
        throw new Error('Seed data is for local development only; disabled in production')
    }
    if ((marketSeeded || candleSeeded) && trades.length === 0) {
        trades.push(...(marketSeeded ? require('./seedMarket').generateMarketTrades(stocks, isValidStockPrice, getDailyPriceLimits) : require('./seedCandles').generateSeedTrades()))
        for (const stock of stocks) {
            const latest = trades.filter(trade => trade.stockCode === stock.code).at(-1)
            if (latest) updateStockPrice(stock, latest.price)
        }
        console.log('[DEV ONLY] Loaded ' + trades.length + ' simulated trades; accounts and orders are unchanged.')
        // One baseline at the seeded current quote; never replay market fixtures as private history.
        const now = new Date().toISOString()
        for (const user of users) equityHistory.replace(user.id, [{ ...getAccountData(user), timestamp: now }])
    }
    if (equitySeeded) {
        const user = users[0]
        equityHistory.replace(user.id, require('./equityHistorySeed').generateEquityHistory(user.id, getAccountData(user)))
        console.log('[DEV ONLY] Loaded simulated equity history for User 1; accounts, orders and trades are unchanged.')
    }
    if (rankingsSeeded) {
        const { createDemoTraders } = require('./rankingsSeed')
        const { generateEquityHistory } = require('./equityHistorySeed')
        const now = Date.now()
        if (users.length === 2) users.push(...createDemoTraders())
        for (const user of users) equityHistory.replace(user.id, generateEquityHistory(user.id, getAccountData(user), now, { profile: user.id, days: 60 }))
        console.log('[DEV ONLY] Loaded fictional trader rankings; no orders or private trades were created.')
    }
    const server = createServer()
    const ready = () => console.log('NiouStock server running at http://localhost:' + PORT)
    // Seeded mode is loopback-only and cannot expose fixture data on the LAN.
    if (seeded) server.listen(PORT, '127.0.0.1', ready)
    else server.listen(PORT, ready)
    return server
}

if (require.main === module) startServer()

module.exports = { app, createServer, startServer, getTickCents, isValidStockPrice, getDailyPriceLimits }
