import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { readApi } from '../stockSnapshot.mjs'
import { historyQuery, formatAmount, formatPnl } from '../tradeHistory.mjs'

export default function TradeHistory() {
    const [filters, setFilters] = useState({ stockCode: '', side: '', days: '' })
    const [page, setPage] = useState(1)
    const [reload, setReload] = useState(0)
    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const change = (key, value) => { setFilters(previous => ({ ...previous, [key]: value })); setPage(1) }
    useEffect(() => {
        const controller = new AbortController()
        setLoading(true); setError(''); setData(null)
        readApi('/accounts/1/trades?' + historyQuery(filters, page), controller.signal)
            .then(value => { if (!controller.signal.aborted) setData(value) })
            .catch(error => { if (!controller.signal.aborted) setError('載入失敗：' + error.message) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [filters, page, reload])
    return <main className="main">
        <section className="welcome"><h1>交易紀錄</h1><p>Test User · User 1 · 實際成交紀錄</p></section>
        <div className="history-filters">
            <label>股票代號 <input value={filters.stockCode} placeholder="全部" onChange={e => change('stockCode', e.target.value)} /></label>
            <label>類型 <select value={filters.side} onChange={e => change('side', e.target.value)}><option value="">全部</option><option value="buy">買入</option><option value="sell">賣出</option></select></label>
            <label>日期 <select value={filters.days} onChange={e => change('days', e.target.value)}><option value="">全部</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></label>
            <button onClick={() => setReload(value => value + 1)} disabled={loading}>更新</button>
        </div>
        {loading && <p role="status">載入中…</p>}
        {error && <p role="alert">{error}</p>}
        {data && <>
            <div className="portfolio-summary">{[
                ['累計買入金額', formatAmount(data.summary.totalBuyAmount)], ['累計賣出金額', formatAmount(data.summary.totalSellAmount)],
                ['已實現損益', formatPnl(data.summary.realizedPnl)], ['成交筆數', data.summary.totalBuys + data.summary.totalSells]
            ].map(([label, value]) => <div className="card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            <div className="market-table-scroll"><table className="market-table">
                <thead><tr>{['時間（台北）', '買 / 賣', '創作者', '代號', '成交價', '股數', '成交金額', '已實現損益'].map(label => <th key={label}>{label}</th>)}</tr></thead>
                <tbody>{data.items.map(item => <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</td>
                    <td>{item.side === 'buy' ? '買入' : '賣出'}</td>
                    <td><Link to={'/stock/' + item.stockCode}>{item.stockName}</Link></td><td><Link to={'/stock/' + item.stockCode}>{item.stockCode}</Link></td>
                    <td>{formatAmount(item.price)}</td><td>{item.quantity}</td><td>{formatAmount(item.amount)}</td><td>{item.side === 'buy' ? '—' : formatPnl(item.realizedPnl)}</td>
                </tr>)}</tbody>
            </table></div>
            {!data.items.length && <p>目前沒有符合條件的成交紀錄。</p>}
            <div className="history-filters">
                <button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一頁</button>
                <span>第 {page} / {Math.max(1, data.pagination.totalPages)} 頁</span>
                <button disabled={page >= data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一頁</button>
            </div>
        </>}
    </main>
}
