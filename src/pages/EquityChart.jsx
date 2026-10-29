import { useEffect, useRef, useState } from 'react'
import { createChart, AreaSeries, CrosshairMode } from 'lightweight-charts'
import { readApi } from '../stockSnapshot.mjs'
import { EQUITY_RANGES, toEquityChartData, formatEquityTime, equityAmount, formatEquityChange } from '../equityHistory.mjs'

export default function EquityChart({ reload }) {
    const host = useRef(null)
    const api = useRef(null)
    const activeRange = useRef(null)
    const [range, setRange] = useState('1M')
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [hovered, setHovered] = useState(null)

    useEffect(() => {
        const controller = new AbortController()
        setLoading(true); setError(''); setData(null); setHovered(null)
        readApi('/accounts/1/equity-history?range=' + range, controller.signal)
            .then(value => { if (!controller.signal.aborted) setData(value) })
            .catch(error => { if (!controller.signal.aborted) setError('資產歷史載入失敗：' + error.message) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [range, reload])

    useEffect(() => {
        const element = host.current
        const chart = createChart(element, {
            width: element.clientWidth, height: element.clientHeight,
            layout: { background: { color: '#ffffff' }, textColor: '#374151', attributionLogo: true },
            crosshair: { mode: CrosshairMode.Normal },
            handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: true },
            timeScale: { timeVisible: true, secondsVisible: true,
                tickMarkFormatter: time => new Date(time * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) },
            localization: { locale: 'zh-TW', timeFormatter: formatEquityTime }
        })
        const series = chart.addSeries(AreaSeries, { lineColor: '#2563eb', topColor: 'rgba(37,99,235,.25)', bottomColor: 'rgba(37,99,235,.02)',
            priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
        const crosshair = event => setHovered(event.seriesData.get(series) || null)
        chart.subscribeCrosshairMove(crosshair)
        const observer = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect
            if (width > 0 && height > 0) chart.resize(Math.floor(width), Math.floor(height))
        })
        observer.observe(element)
        const wheel = event => event.preventDefault()
        element.addEventListener('wheel', wheel, { passive: false })
        api.current = { chart, series }
        activeRange.current = null
        return () => {
            element.removeEventListener('wheel', wheel)
            observer.disconnect()
            chart.unsubscribeCrosshairMove(crosshair)
            chart.remove()
            api.current = null
        }
    }, [])

    useEffect(() => {
        if (!api.current || loading || (data && data.range !== range)) return
        const { chart, series } = api.current
        const visible = chart.timeScale().getVisibleLogicalRange()
        series.setData(toEquityChartData(data?.points || []))
        if (activeRange.current !== range) {
            chart.timeScale().fitContent()
            chart.priceScale('right').applyOptions({ autoScale: true })
            activeRange.current = range
        } else if (visible) chart.timeScale().setVisibleLogicalRange(visible)
        setHovered(null)
    }, [data, loading, range])

    const current = data?.range === range ? data : null
    const points = toEquityChartData(current?.points || [])
    const selected = hovered || points.at(-1)
    return <section className="market-section equity-section">
        <div className="equity-heading"><h2>資產走勢</h2><div className="market-controls" aria-label="資產歷史範圍">
            {EQUITY_RANGES.map(value => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}
        </div></div>
        <div className="equity-summary" aria-live="polite">{!loading && current ? <>
            <strong>{range} {formatEquityChange(current.summary)}</strong>
            <span>最高 ${equityAmount(current.summary.high)} ｜ 最低 ${equityAmount(current.summary.low)}</span>
        </> : <span>{loading ? '載入資產歷史中…' : '資產歷史暫時無法取得'}</span>}</div>
        <div className="candle-chart-info">{!loading && !error && selected ? `${formatEquityTime(selected.time)}（台北） 總資產 $${equityAmount(selected.value)}` : ' '}</div>
        <div className="equity-chart-frame">
            <div className="candle-chart-host" ref={host} aria-label="可拖曳縮放的總資產走勢圖" />
            {(loading || error || points.length < 2) && <div className="candle-chart-overlay" role={error ? 'alert' : 'status'}>
                {loading ? '載入資產歷史中…' : error || '目前尚無足夠資產歷史資料'}
            </div>}
        </div>
        <div className="candle-chart-credit">Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> · 按「更新帳戶」取得最新資產歷史</div>
    </section>
}
