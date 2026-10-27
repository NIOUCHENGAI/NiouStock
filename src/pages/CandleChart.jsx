export default function CandleChart({ candles }) {
    if (!candles.length) return <p>目前尚無成交資料</p>
    const low = Math.min(...candles.map(c => c.low))
    const high = Math.max(...candles.map(c => c.high))
    const span = high - low || 1
    const y = price => 20 + (high - price) / span * 180
    const width = 720 / candles.length
    const time = timestamp => new Date(timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    return <div>
        <svg viewBox="0 0 800 250" role="img" aria-label="Candlestick chart (Asia/Taipei)" style={{ width: '100%', maxWidth: 900 }}>
            <text x="735" y="20" fontSize="12">{high.toFixed(2)}</text>
            <text x="735" y="200" fontSize="12">{low.toFixed(2)}</text>
            {candles.map((c, i) => {
                const x = 10 + width * (i + 0.5)
                const color = c.close >= c.open ? '#c93030' : '#168340'
                return <g key={c.timestamp}>
                    <title>{time(c.timestamp)} Open {c.open} High {c.high} Low {c.low} Close {c.close} Volume {c.volume} / {c.tradeCount} trades</title>
                    <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} />
                    <rect x={x - Math.min(width * .3, 12)} y={y(Math.max(c.open, c.close))} width={Math.min(width * .6, 24)} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} fill={color} />
                </g>
            })}
            <text x="10" y="235" fontSize="11">{time(candles[0].timestamp)}</text>
            <text x="730" y="235" textAnchor="end" fontSize="11">{time(candles.at(-1).timestamp)}</text>
        </svg>
        <p>OHLC: {candles.at(-1).open} / {candles.at(-1).high} / {candles.at(-1).low} / {candles.at(-1).close}</p>
    </div>
}
