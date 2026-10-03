import { useState } from 'react'

function StockDetail() {
    const stock = {
        code: 'YT001',
        name: 'Test Creator',
        category: 'YouTube',
        price: 100.00,
        change: 5.20,
        changePercent: 5.49
    }

    const [quantity, setQuantity] = useState('')
    const [message, setMessage] = useState('')

    const total = Number(quantity || 0) * stock.price

    function handleBuy() {
        if (!quantity || Number(quantity) <= 0) {
            setMessage('請輸入有效的購買數量')
            return
        }

        setMessage(`準備買入 ${quantity} 股，總金額 $${total.toFixed(2)}`)
    }

    function handleSell() {
        if (!quantity || Number(quantity) <= 0) {
            setMessage('請輸入有效的出售數量')
            return
        }

        setMessage(`準備賣出 ${quantity} 股，總金額 $${total.toFixed(2)}`)
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
                    <h2>${stock.price.toFixed(2)}</h2>
                    <p>
                        +{stock.change.toFixed(2)} (
                        +{stock.changePercent.toFixed(2)}%
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
                            onChange={(event) => setQuantity(event.target.value)}
                            placeholder="輸入股數"
                        />
                    </label>

                    <p>預估金額：${total.toFixed(2)}</p>

                    <div>
                        <button onClick={handleBuy}>買入</button>
                        <button onClick={handleSell}>賣出</button>
                    </div>

                    {message && <p>{message}</p>}
                </div>
            </section>
        </div>
    )
}

export default StockDetail