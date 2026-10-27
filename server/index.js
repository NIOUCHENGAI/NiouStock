const express = require('express')
const cors = require('cors')
const http = require('node:http')
const { WebSocketServer, WebSocket } = require('ws')
const { intervals, aggregateCandles } = require('./candles')

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

const stocks = [
    {
        code: 'YT001',
        name: 'Test Creator',
        category: 'YouTube',
        price: 100.00,
        previousClose: 94.80,
        referencePrice: 94.80,
        change: 5.20,
        changePercent: 5.49
    }
]

const users = [
    {
        id: 1,
        name: 'Test User',
        cash: 1000000,
        holdings: {
            YT001: 2000
        }
    },
    {
        id: 2,
        name: 'Test User 2',
        cash: 1000000,
        holdings: {
            YT001: 2000
        }
    }
]

const orders = []
const trades = []

function getTickCents(priceCents) {
    if (priceCents < 1000) {
        return 1
    }

    if (priceCents < 5000) {
        return 5
    }

    if (priceCents < 10000) {
        return 10
    }

    if (priceCents < 50000) {
        return 50
    }

    if (priceCents < 100000) {
        return 100
    }

    return 500
}

function getTickSize(price) {
    const priceCents = Math.round(price * 100)

    return getTickCents(priceCents) / 100
}

function isValidStockPrice(price) {
    if (!Number.isFinite(price) || price <= 0) {
        return false
    }

    const priceCents = Math.round(price * 100)

    if (!Number.isSafeInteger(priceCents)) return false

    if (
        Math.abs(
            price - priceCents / 100
        ) > 0.0000001
    ) {
        return false
    }

    const tickCents = getTickCents(priceCents)

    return priceCents % tickCents === 0
}

function getDailyPriceLimits(stock) {
    const referenceCents =
        Math.round(stock.referencePrice * 100)

    const minimumTickCents =
        getTickCents(referenceCents)

    const tenPercentCents =
        referenceCents / 10

    let limitUpCents
    let limitDownCents

    if (tenPercentCents < minimumTickCents) {
        limitUpCents =
            referenceCents + minimumTickCents

        limitDownCents = Math.max(
            1,
            referenceCents - minimumTickCents
        )
    } else {
        limitUpCents = Math.floor(
            referenceCents * 11 / 10
        )

        while (
            limitUpCents > 0 &&
            limitUpCents %
                getTickCents(limitUpCents) !== 0
        ) {
            limitUpCents--
        }

        limitDownCents = Math.ceil(
            referenceCents * 9 / 10
        )

        while (
            limitDownCents %
                getTickCents(limitDownCents) !== 0
        ) {
            limitDownCents++
        }
    }

    return {
        limitUp: limitUpCents / 100,
        limitDown: limitDownCents / 100
    }
}

function getStockData(stock) {
    const {
        limitUp,
        limitDown
    } = getDailyPriceLimits(stock)

    return {
        ...stock,
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
    const holdings = Object.entries(
        user.holdings
    ).map(([stockCode, quantity]) => {
        const stock = stocks.find(
            item => item.code === stockCode
        )

        const price =
            stock ? stock.price : 0

        const reservedQuantity = orders
            .filter(order => order.userId === user.id && order.stockCode === stockCode && order.side === 'sell' && isOrderOpen(order))
            .reduce((sum, order) => sum + order.remainingQuantity, 0)

        return {
            stockCode,
            quantity,
            availableQuantity: quantity - reservedQuantity,
            reservedQuantity,
            currentPrice: price,
            price,
            marketValue:
                Number(
                    (price * quantity).toFixed(2)
                )
        }
    })

    const holdingsValue =
        holdings.reduce(
            (total, holding) =>
                total + holding.marketValue,
            0
        )

    return {
        id: user.id,
        name: user.name,
        cash: user.cash,
        reservedCash: reservedCashCents / 100,
        availableCash: (Math.round(user.cash * 100) - reservedCashCents) / 100,
        holdings,
        holdingsValue:
            Number(
                holdingsValue.toFixed(2)
            ),
        totalAssets:
            Number(
                (
                    user.cash +
                    holdingsValue
                ).toFixed(2)
            )
    }
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
        buyer.holdings[stock.code] = (buyer.holdings[stock.code] || 0) + tradeQuantity
        seller.holdings[stock.code] -= tradeQuantity

        newOrder.remainingQuantity -=
            tradeQuantity

        matchingOrder.remainingQuantity -=
            tradeQuantity

        updateOrderStatus(newOrder)
        updateOrderStatus(matchingOrder)

        const trade = {
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

        updateStockPrice(
            stock,
            tradePrice
        )
        publish('trade:new', stock.code, publicTrade(trade))
        publish('stock:update', stock.code, getStockData(stock))
        for (const interval of Object.keys(intervals)) {
            const candle = aggregateCandles(trades.filter(t => t.stockCode === stock.code), interval).at(-1)
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

app.get('/api/accounts', (req, res) => res.json(users.map(getAccountData)))

app.get('/api/accounts/:id', (req, res) => {
    const user = users.find(user => user.id === Number(req.params.id))
    if (!user) return res.status(404).json({ message: '找不到這個使用者' })
    res.json(getAccountData(user))
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
    res.json(trades)
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

    res.json(stockTrades)
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
        trades: completedTrades
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

if (require.main === module) createServer().listen(PORT, () => {
    console.log(
        `NiouStock server running at http://localhost:${PORT}`
    )
})

module.exports = { app, createServer, getTickCents, isValidStockPrice, getDailyPriceLimits }
