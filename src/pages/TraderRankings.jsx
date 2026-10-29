import { useEffect, useState } from 'react'
import { readApi } from '../stockSnapshot.mjs'
import { EQUITY_RANGES } from '../equityHistory.mjs'
import { formatAmount, formatPnl } from '../tradeHistory.mjs'

const boards = { assetLeaders: '總資產排行', returnLeaders: '報酬率排行', realizedPnlLeaders: '已實現損益排行' }
export default function TraderRankings() {
    const [period, setPeriod] = useState('1D')
    const [board, setBoard] = useState('assetLeaders')
    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [reload, setReload] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        setLoading(true); setError(''); setData(null)
        readApi('/rankings/traders?period=' + period, controller.signal)
            .then(value => { if (!controller.signal.aborted) setData(value) })
            .catch(error => { if (!controller.signal.aborted) setError('排行榜載入失敗：' + error.message) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [period, reload])
    const rows = data?.period === period ? data[board] : []
    return <main className="main">
        <section className="welcome"><h1>交易者排行榜</h1><p>測試帳戶 · 區間報酬使用已記錄的資產歷史，資料不足時為 0。</p></section>
        <div className="market-controls" role="group" aria-label="排行期間">
            {EQUITY_RANGES.map(value => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value}</button>)}
            <button disabled={loading} onClick={() => setReload(value => value + 1)}>更新</button>
        </div>
        <div className="market-controls" role="group" aria-label="排行指標">{Object.entries(boards).map(([key, title]) =>
            <button key={key} aria-pressed={board === key} onClick={() => setBoard(key)}>{title}</button>)}</div>
        <section className="market-section"><h2>{boards[board]}</h2>
            {loading && <p role="status">載入中…</p>}{error && <p role="alert">{error}</p>}
            <div className="market-table-scroll"><table className="market-table">
                <thead><tr>{['名次', '使用者名稱', '總資產', '區間損益', '報酬率', '已實現損益'].map(title => <th key={title}>{title}</th>)}</tr></thead>
                <tbody>{rows.map(row => <tr key={row.userId}><td>{row.rank}</td><td>{row.name}</td><td>${formatAmount(row.totalAssets)}</td>
                    <td>{formatPnl(row.returnAmount)}</td><td>{formatPnl(row.returnPercent)}%</td><td>{formatPnl(row.realizedPnl)}</td></tr>)}</tbody>
            </table></div>
            {!loading && !error && !rows.length && <p>目前沒有排行榜資料。</p>}
        </section>
    </main>
}
