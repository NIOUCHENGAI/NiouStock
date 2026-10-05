import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

function Market() {
    const [stocks, setStocks] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        fetch('http://localhost:3000/api/stocks')
            .then(response => {
                if (!response.ok) {
                    throw new Error('取得股票資料失敗')
                }

                return response.json()
            })
            .then(data => {
                setStocks(data)
                setLoading(false)
            })
            .catch(() => {
                setError('無法連接 NiouStock 後端')
                setLoading(false)
            })
    }, [])

    return (
        <div className="main">
            <section className="welcome">
                <h1>市場</h1>
                <p>NiouStock 創作者市場</p>
            </section>

            <section className="market-section">
                <div className="section-header">
                    <h2>熱門創作者</h2>
                </div>

                {loading && <p>載入股票資料中...</p>}

                {error && <p>{error}</p>}

                {!loading && !error && stocks.map(stock => (
                    <Link
                        key={stock.code}
                        to={`/stock/${stock.code}`}
                        style={{
                            textDecoration: 'none',
                            color: 'inherit'
                        }}
                    >
                        <div className="stock-row">
                            <div>
                                <strong>{stock.code}</strong>
                                <span>{stock.name}</span>
                                <small>{stock.category}</small>
                            </div>

                            <div>
                                <strong>${stock.price.toFixed(2)}</strong>
                                <span>
                                    {stock.change >= 0 ? '+' : ''}
                                    {stock.change.toFixed(2)}
                                </span>
                                <small>
                                    {stock.changePercent >= 0 ? '+' : ''}
                                    {stock.changePercent.toFixed(2)}%
                                </small>
                            </div>
                        </div>
                    </Link>
                ))}
            </section>
        </div>
    )
}

export default Market