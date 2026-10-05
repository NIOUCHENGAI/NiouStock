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

app.listen(PORT, () => {
    console.log(`NiouStock server running at http://localhost:${PORT}`)
})