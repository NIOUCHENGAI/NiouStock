import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

function StockDetail() {
    const { code } = useParams()

    const [stock, setStock] = useState(null)
    const [orderBook, setOrderBook] = useState({
        buys: [],
        sells: []
    })

    const [price, setPrice] = useState('')
    const [quantity, setQuantity] = useState('')
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    function loadOrderBook() {
        fetch(`http://localhost:3000/api/orderbook/${code}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('取得訂單簿失敗')
                }

                return response.json()
            })
            .then(data => {
                setOrderBook(data)
            })
            .catch(() => {
                setOrderBook({
                    buys: [],
                    sells: []
                })
            })
    }

    useEffect(() => {
        fetch(`http://localhost:3000/api/stocks/${code}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('找不到股票')
                }

                return response.json()
            })
            .then(data => {
                setStock(data)
                setPrice(data.price)
                setLoading(false)
            })
            .catch(() => {
                setError('無法取得股票資料')
                setLoading(false)
            })

        loadOrderBook()
    }, [code])

    async function submitOrder(side) {
        if (!price || Number(price) <= 0) {
            setMessage('請輸入有效的價格')
            return
        }

        if (!quantity || Number(quantity) <= 0) {
            setMessage('請輸入有效的數量')
            return
        }

        try {
            const response = await fetch('http://localhost:3000/api/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    stockCode: stock.code,
                    side,
                    price: Number(price),
                    quantity: Number(quantity)
                })
            })

            const data = await response.json()

            if (!response.ok) {
                setMessage(data.message)
                return
            }

            if (data.trades.length > 0) {
                setMessage(
                    `訂單成功，產生 ${data.trades.length} 筆成交`
                )
            } else {
                setMessage('掛單成功，等待成交')
            }

            setQuantity('')

            const stockResponse = await fetch(
                `http://localhost:3000/api/stocks/${code}`
            )

            const stockData = await stockResponse.json()

            setStock(stockData)
            loadOrderBook()
        } catch {
            setMessage('無法連接交易伺服器')
        }
    }

    if (loading) {
        return (
            <div className="main">
                <p>載入股票資料中...</p>
            </div>
        )
    }

    if (error) {
        return (
            <div className="main">
                <p>{error}</p>
            </div>
        )
    }

    const total = Number(quantity || 0) * Number(price || 0)

    return (
        <div className="main">
            <section className="welcome">
                <p>{stock.category}</p>
                <h1>{stock.name}</h1>
                <p>{stock.code}</p>
            </section>

            <section className="market-section">
                <div>
                    <p>目前價格</p>

                    <h2>
                        ${stock.price.toFixed(2)}
                    </h2>

                    <p>
                        {stock.change >= 0 ? '+' : ''}
                        {stock.change.toFixed(2)}
                        {' '}
                        (
                        {stock.changePercent >= 0 ? '+' : ''}
                        {stock.changePercent.toFixed(2)}%
                        )
                    </p>
                </div>

                <hr />

                <div>
                    <h2>委託簿</h2>

                    <h3>賣單</h3>

                    {orderBook.sells.length === 0 && (
                        <p>目前沒有賣單</p>
                    )}

                    {orderBook.sells.map((order, index) => (
                        <div key={`sell-${order.price}`}>
                            <span>
                                賣{index + 1}
                            </span>

                            {' '}

                            <span>
                                ${order.price.toFixed(2)}
                            </span>

                            {' '}

                            <span>
                                {order.quantity} 股
                            </span>
                        </div>
                    ))}

                    <hr />

                    <h3>買單</h3>

                    {orderBook.buys.length === 0 && (
                        <p>目前沒有買單</p>
                    )}

                    {orderBook.buys.map((order, index) => (
                        <div key={`buy-${order.price}`}>
                            <span>
                                買{index + 1}
                            </span>

                            {' '}

                            <span>
                                ${order.price.toFixed(2)}
                            </span>

                            {' '}

                            <span>
                                {order.quantity} 股
                            </span>
                        </div>
                    ))}
                </div>

                <hr />

                <div>
                    <h2>限價交易</h2>

                    <label>
                        掛單價格
                        <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={price}
                            onChange={(event) =>
                                setPrice(event.target.value)
                            }
                        />
                    </label>

                    <label>
                        數量
                        <input
                            type="number"
                            min="1"
                            value={quantity}
                            onChange={(event) =>
                                setQuantity(event.target.value)
                            }
                            placeholder="輸入股數"
                        />
                    </label>

                    <p>
                        預估金額：${total.toFixed(2)}
                    </p>

                    <div>
                        <button onClick={() => submitOrder('buy')}>
                            買入
                        </button>

                        <button onClick={() => submitOrder('sell')}>
                            賣出
                        </button>
                    </div>

                    {message && <p>{message}</p>}
                </div>
            </section>
        </div>
    )
}

export default StockDetail