import './App.css'

function App() {
    return (
        <div className="app">
            <header className="header">
                <div className="logo">NiouStock</div>

                <nav className="nav">
                    <a href="#">市場</a>
                    <a href="#">自選</a>
                    <a href="#">排行榜</a>
                    <a href="#">我的資產</a>
                </nav>

                <div className="account">
                    <span>虛擬資金</span>
                    <strong>$1,000,000</strong>
                </div>
            </header>

            <main className="main">
                <section className="welcome">
                    <h1>創作者市場</h1>
                    <p>用市場交易，形成對創作者的價格與估值</p>
                </section>

                <section className="market-overview">
                    <div className="card">
                        <span>Niou 大盤</span>
                        <strong>1,000.00</strong>
                        <small>+0.00%</small>
                    </div>

                    <div className="card">
                        <span>今日成交額</span>
                        <strong>$0</strong>
                        <small>尚未開市</small>
                    </div>

                    <div className="card">
                        <span>市場股票</span>
                        <strong>0</strong>
                        <small>檔</small>
                    </div>

                    <div className="card">
                        <span>市場參與者</span>
                        <strong>0</strong>
                        <small>人</small>
                    </div>
                </section>

                <section className="market-section">
                    <div className="section-header">
                        <h2>熱門創作者</h2>
                        <a href="#">查看全部</a>
                    </div>

                    <div className="empty-state">
                        <h3>市場尚未建立</h3>
                        <p>之後會在這裡出現 YouTube、Twitch、VTuber、KOL 等創作者股票。</p>
                    </div>
                </section>
            </main>
        </div>
    )
}

export default App