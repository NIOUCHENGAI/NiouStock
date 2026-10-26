import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { stepPrice } from '../priceSteps.mjs'

function StockDetail() {
    const { code } = useParams()

    const [stock, setStock] = useState(null)

    const [orderBook, setOrderBook] = useState({
        buys: [],
        sells: []
    })

    const [trades, setTrades] = useState([])
    const [openOrders, setOpenOrders] = useState([])
    const [account, setAccount] = useState(null)
    const [busy, setBusy] = useState(false)

    async function loadAccount() {
        const response = await fetch('http://localhost:3000/api/account')
        if (!response.ok) throw new Error('無法取得帳戶資料')
        setAccount(await response.json())
    }

    async function refreshAll() {
        const [stockData] = await Promise.all([
            loadStock(), loadAccount(), loadOrderBook(), loadTrades(), loadOpenOrders()
        ])
        return stockData
    }

    const [price, setPrice] = useState('')
    const [quantity, setQuantity] = useState('')
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    function increasePrice() {
        const nextPrice = stepPrice(price, 1, stock.limitDown, stock.limitUp)
        if (nextPrice !== null) setPrice(nextPrice)
    }

    function decreasePrice() {
        const nextPrice = stepPrice(price, -1, stock.limitDown, stock.limitUp)
        if (nextPrice !== null) setPrice(nextPrice)
    }

    function selectOrderPrice(orderPrice) {
        setPrice(orderPrice)
    }

    function loadOrderBook() {
        return fetch(`http://localhost:3000/api/orderbook/${code}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('取得訂單簿失敗')
                }

                return response.json()
            })
            .then(data => {
                setOrderBook(data)
            })
            .catch(error => {
                setOrderBook({
                    buys: [],
                    sells: []
                })
                throw error
            })
    }

    function loadTrades() {
        return fetch(`http://localhost:3000/api/trades/${code}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('取得成交紀錄失敗')
                }

                return response.json()
            })
            .then(data => {
                setTrades(data)
            })
            .catch(error => {
                setTrades([])
                throw error
            })
    }

    function loadOpenOrders() {
        return fetch('http://localhost:3000/api/orders?userId=1')
            .then(response => {
                if (!response.ok) {
                    throw new Error('取得掛單失敗')
                }

                return response.json()
            })
            .then(data => {
                const filteredOrders = data.filter(order => {
                    return (
                        order.userId === 1 && order.stockCode === code &&
                        (
                            order.status === 'pending' ||
                            order.status === 'partially_filled'
                        )
                    )
                })

                setOpenOrders(filteredOrders)
            })
            .catch(error => {
                setOpenOrders([])
                throw error
            })
    }

    function loadStock() {
        return fetch(
            `http://localhost:3000/api/stocks/${code}`
        )
            .then(response => {
                if (!response.ok) {
                    throw new Error('找不到股票')
                }

                return response.json()
            })
            .then(data => {
                setStock(data)
                return data
            })
    }

    useEffect(() => {
        setLoading(true)
        setError('')
        refreshAll()
            .then(data => {
                setPrice(data.price)
                setLoading(false)
            })
            .catch(() => {
                setError('無法取得股票資料')
                setLoading(false)
            })

    }, [code])

    async function submitOrder(side) {
        if (busy) return
        if (!price || !Number.isFinite(Number(price)) || Number(price) <= 0) {
            setMessage('請輸入有效的價格')
            return
        }

        if (!quantity || Number(quantity) <= 0) {
            setMessage('請輸入有效的數量')
            return
        }

        if (!Number.isSafeInteger(Number(quantity))) {
            setMessage('股數必須為正整數')
            return
        }
        if (!account) {
            setMessage('帳戶資料尚未載入，請重新整理')
            return
        }
        const holding = account.holdings.find(item => item.stockCode === code)
        if (side === 'buy' && Number(price) * Number(quantity) > account.availableCash) {
            setMessage('可用現金不足（已扣除掛單保留資金）')
            return
        }
        if (side === 'sell' && Number(quantity) > (holding?.availableQuantity || 0)) {
            setMessage('可用持股不足（已扣除掛單保留股數）')
            return
        }
        setBusy(true)
        try {
            const response = await fetch(
                'http://localhost:3000/api/orders',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        userId: 1,
                        stockCode: stock.code,
                        side,
                        price: Number(price),
                        quantity: Number(quantity)
                    })
                }
            )

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

            const stockData = await refreshAll()

            setPrice(stockData.price)

        } catch {
            setMessage('交易或資料更新失敗，請重新整理確認訂單狀態')
        } finally {
            setBusy(false)
        }
    }

    async function cancelOrder(orderId) {
        if (busy) return
        setBusy(true)
        try {
            const response = await fetch(
                `http://localhost:3000/api/orders/${orderId}?userId=1`,
                {
                    method: 'DELETE'
                }
            )

            const data = await response.json()

            if (!response.ok) {
                setMessage(data.message)
                return
            }

            setMessage('訂單取消成功')

            try {
                await refreshAll()
            } catch {
                setMessage('訂單取消成功；資料更新失敗，請重新整理')
            }
        } catch {
            setMessage('取消訂單失敗')
        } finally {
            setBusy(false)
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

    const total =
        Number(quantity || 0) *
        Number(price || 0)

    const topBuys =
        orderBook.buys.slice(0, 5)

    const topSells =
        orderBook.sells.slice(0, 5)

    const displaySells =
        [...topSells].reverse()

    return (
        <div className="main">
            <section className="welcome">
                <p>{stock.category}</p>
                <h1>{stock.name}</h1>
                <p>{stock.code}</p>
            </section>

            <section className="market-section">
                {account && <div aria-label="測試帳戶">
                    <h2>{account.name}</h2>
                    <p>可用現金：${account.availableCash.toFixed(2)} ｜ 保留現金：${account.reservedCash.toFixed(2)}</p>
                    <p>{code} 持股：{account.holdings.find(item => item.stockCode === code)?.quantity || 0} 股 ｜ 可用持股：{account.holdings.find(item => item.stockCode === code)?.availableQuantity || 0} 股</p>
                </div>}
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

                    <p>
                        參考價：
                        ${stock.referencePrice.toFixed(2)}
                    </p>

                    <p>
                        漲停：
                        ${stock.limitUp.toFixed(2)}
                    </p>

                    <p>
                        跌停：
                        ${stock.limitDown.toFixed(2)}
                    </p>
                </div>

                <hr />

                <div>
                    <h2>五檔</h2>

                    {displaySells.length === 0 && (
                        <p>目前沒有賣單</p>
                    )}

                    {displaySells.map((order, index) => {
                        const level =
                            displaySells.length - index

                        return (
                            <div key={`sell-${order.price}`}>
                                <span>
                                    賣{level}
                                </span>

                                {' '}

                                <button
                                    type="button"
                                    onClick={() =>
                                        selectOrderPrice(
                                            order.price
                                        )
                                    }
                                >
                                    ${order.price.toFixed(2)}
                                </button>

                                {' '}

                                <span>
                                    {order.quantity} 股
                                </span>
                            </div>
                        )
                    })}

                    <hr />

                    {topBuys.length === 0 && (
                        <p>目前沒有買單</p>
                    )}

                    {topBuys.map((order, index) => (
                        <div key={`buy-${order.price}`}>
                            <span>
                                買{index + 1}
                            </span>

                            {' '}

                            <button
                                type="button"
                                onClick={() =>
                                    selectOrderPrice(
                                        order.price
                                    )
                                }
                            >
                                ${order.price.toFixed(2)}
                            </button>

                            {' '}

                            <span>
                                {order.quantity} 股
                            </span>
                        </div>
                    ))}
                </div>

                <hr />

                <div>
                    <h2>目前掛單</h2>

                    {openOrders.length === 0 && (
                        <p>目前沒有掛單</p>
                    )}

                    {openOrders.map(order => (
                        <div key={order.id}>
                            <span>
                                #{order.id}
                            </span>

                            {' '}

                            <span>
                                {order.side === 'buy'
                                    ? '買入'
                                    : '賣出'}
                            </span>

                            {' '}

                            <span>
                                ${order.price.toFixed(2)}
                            </span>

                            {' '}

                            <span>
                                剩餘 {order.remainingQuantity} 股
                            </span>

                            {' '}

                            <button
                                disabled={busy}
                                onClick={() =>
                                    cancelOrder(order.id)
                                }
                            >
                                取消
                            </button>
                        </div>
                    ))}
                </div>

                <hr />

                <div>
                    <h2>逐筆成交</h2>

                    {trades.length === 0 && (
                        <p>目前沒有成交紀錄</p>
                    )}

                    {trades.map(trade => {
                        const time =
                            new Date(
                                trade.createdAt
                            ).toLocaleTimeString()

                        return (
                            <div key={trade.id}>
                                <span>
                                    {time}
                                </span>

                                {' '}

                                <span>
                                    ${trade.price.toFixed(2)}
                                </span>

                                {' '}

                                <span>
                                    {trade.quantity} 股
                                </span>
                            </div>
                        )
                    })}
                </div>

                <hr />

                <div>
                    <h2>限價交易</h2>

                    <label>
                        掛單價格
                    </label>

                    <div>
                        <button
                            type="button"
                            onClick={decreasePrice}
                        >
                            −
                        </button>

                        <input
                            type="text"
                            inputMode="decimal"
                            value={price}
                            onChange={(event) =>
                                setPrice(event.target.value)
                            }
                        />

                        <button
                            type="button"
                            onClick={increasePrice}
                        >
                            ＋
                        </button>
                    </div>

                    <label>
                        數量

                        <input
                            type="number"
                            min="1"
                            step="1"
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
                        <button
                            disabled={busy}
                            onClick={() =>
                                submitOrder('buy')
                            }
                        >
                            買入
                        </button>

                        <button
                            disabled={busy}
                            onClick={() =>
                                submitOrder('sell')
                            }
                        >
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
