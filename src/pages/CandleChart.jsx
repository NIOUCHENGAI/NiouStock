import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, CrosshairMode } from 'lightweight-charts'
import { chartChange, formatChartTime, toChartCandle, initialRightOffset } from '../chartData.mjs'

const DEFAULT_BAR_SPACING = 9
const DEFAULT_RIGHT_OFFSET = 3

export default function CandleChart({ candles, interval, datasetKey, loading, error }) {
    const host = useRef(null)
    const api = useRef(null)
    const current = useRef({ candles, interval })
    const history = useRef([])
    const activeKey = useRef(null)
    const needsViewportReset = useRef(true)
    const [hovered, setHovered] = useState(null)
    current.current = { candles, interval }

    useEffect(() => {
        const element = host.current
        const chart = createChart(element, {
            width: element.clientWidth, height: element.clientHeight,
            layout: { background: { color: '#ffffff' }, textColor: '#374151', attributionLogo: true },
            rightPriceScale: { visible: true, autoScale: true },
            leftPriceScale: { visible: false },
            crosshair: { mode: CrosshairMode.Normal },
            handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: true },
            timeScale: { barSpacing: DEFAULT_BAR_SPACING, rightOffset: DEFAULT_RIGHT_OFFSET, timeVisible: true, secondsVisible: false, shiftVisibleRangeOnNewBar: false,
                tickMarkFormatter: time => formatChartTime(time, current.current.interval, true) },
            localization: { locale: 'zh-TW', timeFormatter: time => formatChartTime(time, current.current.interval) }
        })
        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#c93030', downColor: '#168340', borderVisible: false,
            wickUpColor: '#c93030', wickDownColor: '#168340',
            priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
        })
        const crosshair = event => {
            const bar = event.seriesData.get(series)
            setHovered(bar ? current.current.candles.find(c => Math.floor(c.timestamp / 1000) === bar.time) ?? null : null)
        }
        chart.subscribeCrosshairMove(crosshair)
        const observer = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect
            if (width > 0 && height > 0) chart.resize(Math.floor(width), Math.floor(height))
        })
        observer.observe(element)
        // Consume wheel inside the plot so zoom never scrolls the document.
        const wheel = event => event.preventDefault()
        element.addEventListener('wheel', wheel, { passive: false })
        api.current = { chart, series }
        history.current = []
        needsViewportReset.current = true
        return () => {
            element.removeEventListener('wheel', wheel)
            observer.disconnect()
            chart.unsubscribeCrosshairMove(crosshair)
            chart.remove()
            api.current = null
        }
    }, [])

    useEffect(() => {
        if (!api.current) return
        const { chart, series } = api.current
        if (activeKey.current !== datasetKey) {
            activeKey.current = datasetKey
            needsViewportReset.current = true
            history.current = []
            series.setData([])
            setHovered(null)
            chart.applyOptions({ timeScale: { timeVisible: interval !== '1d' } })
            chart.priceScale('right').applyOptions({ autoScale: true })
        }
        if (loading) return
        const range = chart.timeScale().getVisibleLogicalRange()
        if (chartChange(history.current, candles) === 'update') {
            const last = history.current.at(-1)?.timestamp ?? -Infinity
            for (const candle of candles) if (candle.timestamp >= last) series.update(toChartCandle(candle))
        } else {
            series.setData(candles.map(toChartCandle))
        }
        if (needsViewportReset.current) {
            // Reset only after the new interval snapshot finishes, even when empty.
            // Use plot width (excluding the price axis) to leave spare slots on the right.
            const timeScale = chart.timeScale()
            const rightOffset = initialRightOffset(timeScale.width(), candles.length, DEFAULT_BAR_SPACING, DEFAULT_RIGHT_OFFSET)
            timeScale.applyOptions({ barSpacing: DEFAULT_BAR_SPACING, rightOffset })
            timeScale.scrollToPosition(rightOffset, false)
            needsViewportReset.current = false
        } else if (range && candles.length) {
            chart.timeScale().setVisibleLogicalRange(range)
        }
        history.current = candles
        setHovered(previous => previous ? candles.find(c => c.timestamp === previous.timestamp) ?? null : null)
    }, [candles, datasetKey, interval, loading])

    const selected = hovered ?? candles.at(-1)
    return <div className="candle-chart-card">
        <div className="candle-chart-info" aria-live="off">
            {!loading && !error && selected ? <>
                {formatChartTime(selected.timestamp / 1000, interval)}{'  '}
                O {selected.open.toFixed(2)}{'  '}H {selected.high.toFixed(2)}{'  '}
                L {selected.low.toFixed(2)}{'  '}C {selected.close.toFixed(2)}{'  '}V {selected.volume}
            </> : ' '}
        </div>
        <div className="candle-chart-frame">
            <div ref={host} className="candle-chart-host" aria-label="Interactive candlestick chart" />
            {(loading || error || !candles.length) && <div className="candle-chart-overlay" role={error ? 'alert' : 'status'}>
                {loading ? '載入 K 線中…' : error || '目前尚無成交資料'}
            </div>}
        </div>
        <div className="candle-chart-credit">Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a></div>
    </div>
}
