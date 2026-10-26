function tickCents(cents) {
    if (cents < 1000) return 1
    if (cents < 5000) return 5
    if (cents < 10000) return 10
    if (cents < 50000) return 50
    if (cents < 100000) return 100
    return 500
}

// Returns null for invalid inputs. Check bounds before converting user input to cents.
export function stepPrice(value, direction, limitDown, limitUp) {
    const price = Number(value)
    const low = Math.round(limitDown * 100)
    const high = Math.round(limitUp * 100)
    if (!Number.isFinite(price) || !Number.isSafeInteger(low) ||
        !Number.isSafeInteger(high) || low <= 0 || high < low ||
        (direction !== 1 && direction !== -1)) return null
    if (price < limitDown) return low / 100
    if (price > limitUp) return high / 100

    const scaled = price * 100
    if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER - 500) return null
    const start = direction === 1
        ? Math.floor(scaled + 0.0000001) + 1
        : Math.ceil(scaled - 0.0000001) - 1
    // The largest tick is 500 cents, so a legal price is at most 500 steps away.
    for (let offset = 0; offset < 500; offset++) {
        const cents = start + direction * offset
        if (cents <= low) return low / 100
        if (cents >= high) return high / 100
        if (cents % tickCents(cents) === 0) return cents / 100
    }
    return null
}
