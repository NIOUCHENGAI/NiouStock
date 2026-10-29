import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { readApi, WS_URL } from '../stockSnapshot.mjs'
import { revaluePortfolio } from '../portfolioMath.mjs'

const amount = value => value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = value => (value > 0 ? '+' : '') + amount(value)
export default function Portfolio() {
    const [portfolio, setPortfolio] = useState(null)
    const [error, setError] = useState('')
    const [status, setStatus] = useState('行情連線中')
    const [reload, setReload] = useState(0)
    useEffect(() => {
        let disposed = false, socket, timer, generation = 0, attempt = 0, pending = null
        const controller = new AbortController()
        const apply = event => setPortfolio(previous => previous ? revaluePortfolio(previous, event.data) : previous)
        const snapshot = async () => {
            const id = ++generation, queue = []
            pending = queue
            try {
                let data = await readApi('/portfolio/1', controller.signal)
                if (disposed || id !== generation) return
                for (const event of queue) data = revaluePortfolio(data, event.data)
                setPortfolio(data)
                setError('')
            } catch (error) {
                if (disposed || id !== generation) return
                queue.forEach(apply)
                setError('資產資料更新失敗：' + error.message)
            } finally {
                if (!disposed && id === generation) pending = null
            }
        }
        const connect = () => {
            socket = new WebSocket(WS_URL)
            socket.onopen = () => { attempt = 0; setStatus('即時估值已連線'); snapshot() }
            socket.onmessage = message => {
                try {
                    const event = JSON.parse(message.data)
                    if (event.type !== 'stock:update' || event.stockCode !== event.data?.code) return
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
                socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
                socket.close()
            }
        }
    }, [reload])
    return <div className="main">
        <section className="welcome"><h1>我的資產</h1><p>測試帳戶 User 1 · 移動平均成本</p></section>
        <p role="status">{status}</p>
        <button type="button" onClick={() => setReload(value => value + 1)}>更新帳戶</button>
        {error && <p role="alert">{error}</p>}
        {!portfolio && !error && <p>載入資產資料中…</p>}
        {portfolio && <>
            <div className="portfolio-summary">
                {[['totalAssets','總資產',false],['holdingsValue','持股市值',false],['cash','現金',false],['todayPnl','今日損益',true],['unrealizedPnl','未實現損益',true],['realizedPnl','已實現損益',true]].map(([key,label,pnl]) => <div className="card" key={key}><span>{label}</span><strong>{pnl ? signed(portfolio.summary[key]) : amount(portfolio.summary[key])}</strong></div>)}
            </div>
            <p>可用現金：{amount(portfolio.summary.availableCash)} ｜ 保留現金：{amount(portfolio.summary.reservedCash)}</p>
            <section className="market-section"><h2>持股</h2>
                <div className="market-table-scroll"><table className="market-table">
                    <thead><tr>{['創作者','代號','分類','股數','可用股數','平均成本','現價','成本','市值','未實現損益','未實現 %','今日損益'].map(title => <th key={title}>{title}</th>)}</tr></thead>
                    <tbody>{portfolio.positions.map(position => <tr key={position.stockCode}>
                        <td><Link to={'/stock/' + position.stockCode}>{position.name}</Link></td><td>{position.stockCode}</td><td>{position.category}</td><td>{position.quantity}</td><td>{position.availableQuantity}</td>
                        <td>{position.averageCost.toLocaleString('zh-TW', { maximumFractionDigits: 6 })}</td><td>{amount(position.price)}</td><td>{amount(position.costBasis)}</td><td>{amount(position.marketValue)}</td><td>{signed(position.unrealizedPnl)}</td><td>{signed(position.unrealizedPnlPercent)}%</td><td>{signed(position.todayPnl)}</td>
                    </tr>)}</tbody>
                </table></div>
                {!portfolio.positions.length && <p>目前沒有持股</p>}
            </section>
            <p>今日損益以「現價 − 昨收」× 目前股數計算；其他視窗交易後請更新帳戶。</p>
        </>}
    </div>
}
