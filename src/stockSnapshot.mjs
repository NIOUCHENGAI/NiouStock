export const API_BASE = 'http://localhost:3000/api'
export const WS_URL = 'ws://localhost:3000/ws'

export async function readApi(path, signal) {
    const response = await fetch(API_BASE + path, { signal })
    if (!response.ok) throw new Error(path + ': HTTP ' + response.status + ' ' + response.statusText)
    try { return await response.json() }
    catch { throw new Error(path + ': invalid JSON response') }
}

// Each region commits independently; a slow or failed optional request cannot hide stock data.
export async function loadSnapshot(read, code, interval, handlers, isCurrent) {
    const paths = { stock: '/stocks/' + code, book: '/orderbook/' + code,
        trades: '/trades/' + code, account: '/account', orders: '/orders?userId=1',
        candles: '/candles/' + code + '?interval=' + interval + '&limit=100' }
    return Promise.allSettled(Object.entries(paths).map(async ([key, path]) => {
        try {
            const data = await read(path)
            if (isCurrent()) handlers[key].success(data)
        } catch (error) {
            if (isCurrent()) handlers[key].failure(error)
        }
    }))
}
