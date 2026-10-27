import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { readApi, loadSnapshot, WS_URL } from '../stockSnapshot.mjs'
import CandleChart from './CandleChart'
import { addTrade, updateCandle } from '../marketUpdates.mjs'
import { stepPrice } from '../priceSteps.mjs'

function StockDetail() {
    const { code } = useParams()

    const [interval, setInterval] = useState('1m')
    const [candles, setCandles] = useState([])
    const [marketStatus, setMarketStatus] = useState('行情連線中')
    const [candleError, setCandleError] = useState('')
    const [regionErrors, setRegionErrors] = useState({})

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
        await Promise.all([loadAccount(), loadOpenOrders()])
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

    useEffect(() => {
        let disposed = false
        let socket
        let timer
        let attempt = 0
        let generation = 0
        let pending = null
        let initialized = false
        const controller = new AbortController()
        setLoading(true)
        setError('')
        setCandles([])
        setStock(null)
        setAccount(null)
        setOrderBook({ buys: [], sells: [] })
        setTrades([])
        setOpenOrders([])
        setRegionErrors({})
        setCandleError('')
        const read = path => readApi(path, controller.signal)
        const apply = event => {
            if (event.stockCode !== code) return
            if (event.type === 'stock:update') setStock(event.data)
            if (event.type === 'orderbook:update') setOrderBook(event.data)
            if (event.type === 'trade:new') setTrades(items => addTrade(items, event.data))
            if (event.type === 'candle:update' && event.data.interval === interval) setCandles(items => updateCandle(items, event.data.candle))
        }
        const snapshot = async () => {
            const id = ++generation
            const queue = []
            pending = queue
            const isCurrent = () => !disposed && id === generation
            const region = (key, success, reset) => ({
                success: data => {
                    success(data)
                    setRegionErrors(errors => ({ ...errors, [key]: '' }))
                },
                failure: error => {
                    reset()
                    setRegionErrors(errors => ({ ...errors, [key]: error.message }))
                }
            })
            await loadSnapshot(read, code, interval, {
                stock: {
                    success: data => {
                        setStock(data)
                        if (!initialized) setPrice(data.price)
                        initialized = true
                        setError('')
                        setLoading(false)
                    },
                    failure: error => {
                        setError('無法取得股票資料：' + error.message)
                        setLoading(false)
                    }
                },
                book: region('book', setOrderBook, () => setOrderBook({ buys: [], sells: [] })),
                trades: region('trades', history => setTrades([...history].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id).slice(0, 100)), () => setTrades([])),
                account: region('account', setAccount, () => setAccount(null)),
                orders: region('orders', orders => setOpenOrders(orders.filter(o => o.stockCode === code && ['pending', 'partially_filled'].includes(o.status))), () => setOpenOrders([])),
                candles: {
                    success: data => { setCandles(data); setCandleError('') },
                    failure: error => { setCandles([]); setCandleError(error.message) }
                }
            }, isCurrent)
            if (isCurrent()) {
                queue.forEach(apply)
                pending = null
            }
        }
        const connect = () => {
            if (disposed) return
            socket = new WebSocket(WS_URL)
            socket.onopen = () => {
                attempt = 0
                setMarketStatus('即時行情已連線')
                snapshot()
            }
            socket.onmessage = message => {
                try {
                    const event = JSON.parse(message.data)
                    if (pending) pending.push(event)
                    else apply(event)
                } catch { /* Ignore malformed messages. */ }
            }
            socket.onerror = () => socket.close()
            socket.onclose = () => {
                if (disposed) return
                setMarketStatus('行情已斷線，正在重新連線；REST 仍可使用')
                timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 5000))
            }
        }
        snapshot()
        connect()
        return () => {
            disposed = true
            controller.abort()
            clearTimeout(timer)
            if (socket) {
                socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
                socket.close()
            }
        }
    }, [code, interval])

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

            await refreshAll()

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
                {regionErrors.account && <p role="alert">{regionErrors.account}</p>}
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
                    <p role="status">{marketStatus}</p>
                    <h2>K 線</h2>
                    {['1m', '5m', '15m', '1h', '1d'].map(value => <button key={value} type="button" aria-pressed={interval === value} onClick={() => setInterval(value)}>{value}</button>)}
                    {candleError && <p role="alert">{candleError}</p>}
                    {!candleError && <CandleChart candles={candles} />}
                </div>
                <hr />
                <div>
                    <h2>五檔</h2>
                    {regionErrors.book && <p role="alert">{regionErrors.book}</p>}

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
                    {regionErrors.orders && <p role="alert">{regionErrors.orders}</p>}

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
                    {regionErrors.trades && <p role="alert">{regionErrors.trades}</p>}

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
