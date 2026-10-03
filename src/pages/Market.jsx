import { Link } from 'react-router-dom'

function Market() {
    const stock = {
        code: 'YT001',
        name: 'Test Creator',
        category: 'YouTube',
        price: 100.00,
        change: 5.20,
        changePercent: 5.49
    }

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

                <Link
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
                            <span>+{stock.change.toFixed(2)}</span>
                            <small>+{stock.changePercent.toFixed(2)}%</small>
                        </div>
                    </div>
                </Link>
            </section>
        </div>
    )
}

export default Market