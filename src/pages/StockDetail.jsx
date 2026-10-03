function StockDetail() {
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
                <p>{stock.category}</p>
                <h1>{stock.name}</h1>
                <p>{stock.code}</p>
            </section>

            <section className="market-section">
                <div>
                    <p>目前價格</p>
                    <h2>${stock.price.toFixed(2)}</h2>
                    <p>+{stock.change.toFixed(2)} ({stock.changePercent.toFixed(2)}%)</p>
                </div>

                <hr />

                <div>
                    <h2>交易</h2>

                    <label>
                        價格
                        <input
                            type="number"
                            value={stock.price}
                            readOnly
                        />
                    </label>

                    <label>
                        數量
                        <input
                            type="number"
                            min="1"
                            placeholder="輸入股數"
                        />
                    </label>

                    <div>
                        <button>買入</button>
                        <button>賣出</button>
                    </div>
                </div>
            </section>
        </div>
    )
}

export default StockDetail