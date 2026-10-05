import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

function StockDetail() {
    const { code } = useParams()

    const [stock, setStock] = useState(null)
    const [quantity, setQuantity] = useState('')
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

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
                setLoading(false)
            })
            .catch(() => {
                setError('無法取得股票資料')
                setLoading(false)
            })
    }, [code])

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

    const total = Number(quantity || 0) * stock.price

    function handleBuy() {
        if (!quantity || Number(quantity) <= 0) {
            setMessage('請輸入有效的購買數量')
            return
        }

        setMessage(
            `準備買入 ${quantity} 股，總金額 $${total.toFixed(2)}`
        )
    }

    function handleSell() {
        if (!quantity || Number(quantity) <= 0) {
            setMessage('請輸入有效的出售數量')
            return
        }

        setMessage(
            `準備賣出 ${quantity} 股，總金額 $${total.toFixed(2)}`
        )
    }

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
                    <h2>交易</h2>

                    <label>
                        價格
                        <input
                            type="number"
                            value={stock.price}
                            readOnly
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
                        <button onClick={handleBuy}>
                            買入
                        </button>

                        <button onClick={handleSell}>
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