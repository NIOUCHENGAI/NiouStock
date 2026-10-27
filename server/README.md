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
