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
        change: 5.20,
        changePercent: 5.49
    }
]

const orders = []

function findMatchingOrder(newOrder) {
    const candidates = orders.filter(order => {
        if (order.stockCode !== newOrder.stockCode) {
            return false
        }

        if (order.status !== 'pending') {
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

app.get('/api', (req, res) => {
    res.json({
        message: 'NiouStock API 正常運作'
    })
})

app.get('/api/stocks', (req, res) => {
    res.json(stocks)
})

app.get('/api/stocks/:code', (req, res) => {
    const stock = stocks.find(item => item.code === req.params.code)

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

app.post('/api/orders', (req, res) => {
    const {
        stockCode,
        side,
        price,
        quantity
    } = req.body

    const stock = stocks.find(item => item.code === stockCode)

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
        status: 'pending',
        createdAt: new Date().toISOString()
    }

    const matchingOrder = findMatchingOrder(order)

    orders.push(order)

    res.status(201).json({
        message: matchingOrder
            ? '訂單建立成功，找到可撮合的對手單'
            : '訂單建立成功，目前沒有可撮合的對手單',
        order,
        matchingOrder
    })
})

app.listen(PORT, () => {
    console.log(`NiouStock server running at http://localhost:${PORT}`)
})