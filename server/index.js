const express = require('express')
const cors = require('cors')

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())

const stocks = [
    {
        code: 'YT001',
        name: 'Test Creator',
        category: 'YouTube',
        price: 100.00,
        previousClose: 94.80,
        change: 5.20,
        changePercent: 5.49
    }
]

const orders = []
const trades = []

function isOrderOpen(order) {
    return (
        order.status === 'pending' ||
        order.status === 'partially_filled'
    )
}

function updateOrderStatus(order) {
    if (order.remainingQuantity === 0) {
        order.status = 'filled'
    } else if (order.remainingQuantity < order.quantity) {
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
        (stock.price - stock.previousClose).toFixed(2)
    )

    stock.changePercent = Number(
        (
            (stock.change / stock.previousClose) *
            100
        ).toFixed(2)
    )
}

function executeMatches(newOrder, stock) {
    const completedTrades = []

    while (newOrder.remainingQuantity > 0) {
        const matchingOrder = findMatchingOrder(newOrder)

        if (!matchingOrder) {
            break
        }

        const tradeQuantity = Math.min(
            newOrder.remainingQuantity,
            matchingOrder.remainingQuantity
        )

        const tradePrice = matchingOrder.price

        newOrder.remainingQuantity -= tradeQuantity
        matchingOrder.remainingQuantity -= tradeQuantity

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
            createdAt: new Date().toISOString()
        }

        trades.push(trade)
        completedTrades.push(trade)

        updateStockPrice(stock, tradePrice)
    }

    updateOrderStatus(newOrder)

    return completedTrades
}

app.get('/api', (req, res) => {
    res.json({
        message: 'NiouStock API 正常運作'
    })
})

app.get('/api/stocks', (req, res) => {
    res.json(stocks)
})

app.get('/api/stocks/:code', (req, res) => {
    const stock = stocks.find(
        item => item.code === req.params.code
    )

    if (!stock) {
        return res.status(404).json({
            message: '找不到這支股票'
        })
    }

    res.json(stock)
})

app.get('/api/orders', (req, res) => {
    res.json(orders)
})

app.get('/api/trades', (req, res) => {
    res.json(trades)
})

app.post('/api/orders', (req, res) => {
    const {
        stockCode,
        side,
        price,
        quantity
    } = req.body

    const stock = stocks.find(
        item => item.code === stockCode
    )

    if (!stock) {
        return res.status(404).json({
            message: '找不到這支股票'
        })
    }

    if (side !== 'buy' && side !== 'sell') {
        return res.status(400).json({
            message: '訂單方向錯誤'
        })
    }

    if (!price || Number(price) <= 0) {
        return res.status(400).json({
            message: '價格必須大於 0'
        })
    }

    if (!quantity || Number(quantity) <= 0) {
        return res.status(400).json({
            message: '數量必須大於 0'
        })
    }

    const order = {
        id: orders.length + 1,
        stockCode,
        side,
        price: Number(price),
        quantity: Number(quantity),
        remainingQuantity: Number(quantity),
        status: 'pending',
        createdAt: new Date().toISOString()
    }

    orders.push(order)

    const completedTrades = executeMatches(
        order,
        stock
    )

    res.status(201).json({
        message:
            completedTrades.length > 0
                ? '訂單建立成功並產生成交'
                : '訂單建立成功，目前沒有成交',
        order,
        trades: completedTrades
    })
})

app.listen(PORT, () => {
    console.log(
        `NiouStock server running at http://localhost:${PORT}`
    )
})