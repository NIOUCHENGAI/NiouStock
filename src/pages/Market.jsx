import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { readApi, WS_URL } from '../stockSnapshot.mjs'
import { filterStocks, marketRankings, updateMarket } from '../marketHelpers.mjs'

const signed = value => (value > 0 ? '+' : '') + value.toFixed(2)
export default function Market() {
    const navigate = useNavigate()
    const [stocks, setStocks] = useState([])
    const [rankings, setRankings] = useState(null)
    const [category, setCategory] = useState('全部')
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [status, setStatus] = useState('行情連線中')
    useEffect(() => {
        let disposed = false, socket, timer, attempt = 0, generation = 0
        let pending = null
        const controller = new AbortController()
        const apply = event => {
            if (event.type !== 'stock:update' || event.stockCode !== event.data?.code) return
            setStocks(items => updateMarket(items, event.data))
        }
        const snapshot = async () => {
            const id = ++generation, queue = []
            pending = queue
            const results = await Promise.allSettled([readApi('/stocks', controller.signal), readApi('/market/rankings', controller.signal)])
            if (disposed || id !== generation) return
            if (results[0].status === 'fulfilled') {
                let next = results[0].value
                for (const event of queue) if (event.type === 'stock:update' && event.stockCode === event.data?.code) next = updateMarket(next, event.data)
                setStocks(next)
                setRankings(results[1].status === 'fulfilled' && !queue.length ? results[1].value : marketRankings(next))
                setError('')
            } else {
                setError('市場資料取得失敗：' + results[0].reason.message)
                queue.forEach(apply)
            }
            pending = null
            setLoading(false)
        }
        const connect = () => {
            socket = new WebSocket(WS_URL)
            socket.onopen = () => {
                attempt = 0
                setStatus('即時行情已連線')
                snapshot()
            }
            socket.onmessage = message => {
                try {
                    const event = JSON.parse(message.data)
                    if (event.type !== 'stock:update') return
                    if (pending) pending.push(event)
                    else apply(event)
                } catch { /* Ignore malformed messages. */ }
            }
            socket.onerror = () => socket.close()
            socket.onclose = () => {
                if (disposed) return
                setStatus('行情已斷線，正在重新連線')
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
                socket.onopen = socket.onclose = socket.onmessage = socket.onerror = null
                socket.close()
            }
        }
    }, [])
    // Rankings always follow the current full market, independent of list filters.
    const currentRankings = useMemo(() => stocks.length ? marketRankings(stocks) : rankings, [stocks, rankings])
    const visible = useMemo(() => filterStocks(stocks, category, search), [stocks, category, search])
    return <div className="main">
        <section className="welcome"><h1>NiouStock 市場</h1><p>虛構創作者測試市場</p></section>
        <p role="status">{status}</p>
        {loading && <p>載入市場資料中…</p>}
        {error && <p role="alert">{error}</p>}
        <div className="market-rankings">
            {[['gainers', '漲幅排行', 'changePercent'], ['losers', '跌幅排行', 'changePercent'], ['volumeLeaders', '成交量排行', 'volume']].map(([key, title, metric]) =>
                <section className="market-section" key={key}><h2>{title}</h2><ol>
                    {(currentRankings?.[key] ?? []).map(stock => <li key={stock.code}><Link to={'/stock/' + stock.code}>{stock.name} ({stock.code})</Link>{' '}{metric === 'volume' ? stock.volume.toLocaleString() + ' 股' : signed(stock.changePercent) + '%'}</li>)}
                </ol></section>)}
        </div>
        <section className="market-section">
            <div className="market-controls">
                <div role="group" aria-label="分類篩選">{['全部', 'YouTube', 'Twitch', 'VTuber', 'KOL'].map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div>
                <label>搜尋創作者或代號 <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="例如 YT002 或 Nova" /></label>
            </div>
            <div className="market-table-scroll"><table className="market-table">
                <thead><tr>{['創作者', '代號', '分類', '現價', '漲跌', '漲跌幅', '成交量'].map(title => <th key={title}>{title}</th>)}</tr></thead>
                <tbody>{visible.map(stock => <tr key={stock.code} onClick={() => navigate('/stock/' + stock.code)}>
                    <td><Link to={'/stock/' + stock.code}>{stock.name}</Link></td><td>{stock.code}</td><td>{stock.category}</td><td>{stock.price.toFixed(2)}</td><td>{signed(stock.change)}</td><td>{signed(stock.changePercent)}%</td><td>{stock.volume.toLocaleString()}</td>
                </tr>)}</tbody>
            </table></div>
            {!loading && !visible.length && <p>沒有符合條件的股票</p>}
        </section>
    </div>
}
