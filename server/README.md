# Prototype trading API

Run `node server/index.js` for port 3000, `npm run dev` for the frontend,
`npm test` for isolated HTTP integration tests, and `npm run build` for production assets.
On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

All state is in memory and resets on server restart. Users 1 and 2 each start
with 1,000,000 virtual cash and 2,000 YT001 shares.

- `GET /api/account`: compatible User 1 account response; `price` is retained on holdings.
- `GET /api/accounts/` and `GET /api/accounts/:id`: test accounts with available/reserved assets.
- `GET /api/orders?userId=1`: that user's order history (default user 1).
- `POST /api/orders`: `{ userId, stockCode, side, price, quantity }` (default user 1).
- `DELETE /api/orders/:id?userId=1`: cancel an open order owned by that user.
- Stock, full aggregated order book, and trade endpoints retain their existing routes.

Cash includes reserved cash. Reservations are derived from open orders:
buy limit price × remaining shares; sell remaining shares. Available assets
subtract these reservations. Settlement changes total cash/shares at the resting
order price, using integer cents, and decreases both order remainders synchronously.
There are no asynchronous operations between validation and settlement.

User IDs are a testing convention, not authentication or access control: callers
can specify either user. The frontend always uses User 1 and only requests their
orders. Public order book levels aggregate all users. A future login system must
derive the user from a trusted session instead of caller-supplied IDs.

**安全限制：目前 userId 是測試用途，由呼叫端指定。此版本不得直接暴露為公開正式服務。
真正上線前必須由可信 authentication context 決定 userId。**

Validated prices are immediately normalized to integer cents and converted back
to yuan for API/order fields. All matching, aggregation and settlement use this
canonical price. A new order crossing any of its owner's opposite open orders
(including partially filled orders) is rejected before insertion or reservation;
the matching engine does not skip better-priced orders to avoid self-trading.


Public WebSocket: ws://localhost:3000/ws, sharing the HTTP server.
JSON envelope: { type, stockCode, data }.
- orderbook:update: complete aggregated book after accepted orders/cancellations.
- trade:new: public id, stockCode, price, quantity, createdAt per actual fill.
- stock:update: latest price, change, changePercent and stock metadata.
- candle:update: { stockCode, interval, candle } for each supported interval.
No account balances, holdings, user IDs or private orders are broadcast.

GET /api/candles/:code?interval=1m&limit=100 returns oldest-to-newest candles.
Intervals: 1m, 5m, 15m, 1h, 1d. Limit: integer 1?500 (default 100).
Invalid query: 400; unknown stock: 404; no trades: []. Candles aggregate actual
trades on demand with no synthetic empty buckets. Timestamp is bucket-start Unix
milliseconds; daily boundaries use Asia/Taipei (UTC+8), intraday buckets use UTC.
Fields: timestamp, open, high, low, close, volume, tradeCount.

StockDetail loads REST snapshots on entry, interval changes and WS reconnect,
queues events during snapshots, then applies events directly. No polling.
Reconnect delays: 1s, 2s, 4s, maximum 5s. Unmount cancels requests/timers/socket.
Own actions refresh account/orders only. REST remains available while WS is down;
reload to refresh market data if disconnected. SVG charts retain 100 candles,
with Taipei timestamps, OHLC labels and tooltips. Private account changes from
other clients require manual refresh. State is unbounded in memory and lost on
restart; no authentication, durable history or subscription filtering is provided.


### Local candle fixtures
Stop the existing backend first (Ctrl+C); then run:

    node server/seedCandles.js

Equivalent PowerShell startup:

    $env:NIOUSTOCK_SEED_CANDLES='1'; node server/index.js

This starts a new server on port 3000, bound to 127.0.0.1 only. It does not
inject data into an already-running server. NODE_ENV=production rejects seed mode.
No seed HTTP endpoint exists. Only the main startup path seeds; importing the
module in tests does not. Normal startup never adds fixture data.

The fixed formula produces 120 synthetic trades over the previous 60 completed
minutes (1?3 trades/minute), prices 96?103 in legal 0.50 ticks, with varying
volumes. The same anchor time always gives identical results. Timestamps move
with startup time; intervals naturally straddling boundaries may yield 12?13
five-minute or 4?5 fifteen-minute candles. Daily buckets follow Taipei midnight,
so startup just after midnight can include yesterday as well as today.

Fixture trades carry simulated:true and do not represent settled transactions.
They add chart/trade history and set the displayed stock price to the last
fixture price. Cash, holdings, reservations, orders and matching rules are not
changed. Existing history is not overwritten. All data remains in memory.

To return to empty normal data, stop the server, then in PowerShell run:

    Remove-Item Env:NIOUSTOCK_SEED_CANDLES -ErrorAction SilentlyContinue
    node server/index.js

Reload the frontend after restarting to clear its cached snapshot.


## Market prototype
The market has 12 fictional creators (3 each in YouTube, Twitch, VTuber, KOL).
GET /api/stocks and GET /api/stocks/:code include volume (shares), turnover
(currency), and tradeCount for the current Asia/Taipei calendar day. These
aggregate actual trade records only, including explicitly seeded simulated trades;
orders never count toward volume. Turnover sums integer cents.
GET /api/market/rankings returns gainers, losers, volumeLeaders, turnoverLeaders,
5 each, with code as the deterministic tie-breaker. Gainers/losers sort the whole
market by changePercent (including zero/negative/positive entries as applicable).
stock:update includes these same market fields per fill. Market loads REST on
entry/reconnect, then updates locally and reranks without polling. Category/search
filters apply locally to the table; rankings always cover the full market.

Stop the backend, then run node server/seedMarket.js for varied market history.
Equivalent PowerShell: $env:NIOUSTOCK_SEED_MARKET='1'; node server/index.js
The fixed formula generates historical legal-tick prices within each stock's
limits, mixed gains/losses and different volumes. Seed mode is loopback-only and
blocked with NODE_ENV=production. No seed endpoint exists. If both seed flags
are set, market seed takes precedence. seedCandles.js remains available separately.
For clean normal mode, stop the server, clear both flags, then restart:

    Remove-Item Env:NIOUSTOCK_SEED_MARKET -ErrorAction SilentlyContinue
    Remove-Item Env:NIOUSTOCK_SEED_CANDLES -ErrorAction SilentlyContinue
    node server/index.js

Reload the frontend after restarting. Seeds never settle cash/shares or create
orders; they change trade history, displayed prices and holding market values.
User 1 additionally holds YT002/VT001; User 2 holds TW003/KO001. Both retain their
original YT001 position. No automatic midnight broadcast exists: daily stats reset
on the next stock update or REST reload/reconnect. State still resets on restart.

Market seed density: each stock now has 60 completed minutes of history. Active
stocks use 3?5 trades/minute; others use 2?4. Fixed trend/oscillation formulas and
intraminute legal-price-level offsets create visible OHLC ranges. Expect 60 1m,
12?13 5m, 4?5 15m, and 1?2 1h candles depending on bucket alignment. Daily
aggregation can span Taipei midnight. All prices remain canonical legal ticks
within each stock's limits. No production aggregation or realtime logic changes.


## Portfolio and cost basis
Holdings are structured positions: quantity, averageCostMicros and
realizedPnlMicros (BigInt integer millionths of currency). Moving average cost is
weighted per actual fill, with six decimal places rounded half away from zero.
Selling keeps remaining average cost unchanged and accumulates (fill price minus
average cost) times filled shares. A closed holding stays in memory with zero
quantity/cost and retained realized PnL; reentry starts a new average cost.
Cash still settles once in integer cents; PnL never adds extra cash.
Public averageCost uses six decimals; monetary totals round to cents. Cost basis
is average cost times quantity, rounded to cents; tiny rounding differences are
possible with fractional averages. Both backend and frontend use the same pure
valuation helpers (Node supporting synchronous require of ESM is required).
Initial YT001 costs are 94.80 for both users. User 1: YT002 48, VT001 38;
User 2: TW003 115, KO001 26. Seeds only change quotes/history, never cost basis.

GET /api/account and /api/accounts/:id retain their fields and add summary,
averageCost, costBasis, realizedPnl, unrealizedPnl/Percent, todayPnl/Percent.
Unrealized PnL = market value minus cost basis; percentage divides by cost basis.
Prototype todayPnl = (price - previousClose) times current quantity; percentage
uses previousClose. Zero denominators return 0. This is not exact intraday PnL
attribution for newly bought positions. Summary includes realized PnL from closed
holdings. totalAssets = cash + holdingsValue, without adding reserves or costs.
GET /api/portfolio/:userId returns user, summary, positions (quantity > 0).
The /portfolio page uses User 1, with public stock:update events revaluing quotes
only; quantity/cash/cost are refreshed via REST on entry, reconnect or manual
refresh. Other clients' private trades require a refresh; no private WS exists.
IDs remain caller-supplied test identities, not authentication. Data is in memory
and disappears on restart. No fees, taxes, corporate actions or persisted ledger.
