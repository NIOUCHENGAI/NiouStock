// Pure price rules shared by order validation and frontend price stepping.
export function getTickCents(priceCents) {
    if (priceCents < 1000) {
        return 1
    }

    if (priceCents < 5000) {
        return 5
    }

    if (priceCents < 10000) {
        return 10
    }

    if (priceCents < 50000) {
        return 50
    }

    if (priceCents < 100000) {
        return 100
    }

    return 500
}

export function getTickSize(price) {
    const priceCents = Math.round(price * 100)

    return getTickCents(priceCents) / 100
}

export function isValidStockPrice(price) {
    if (!Number.isFinite(price) || price <= 0) {
        return false
    }

    const priceCents = Math.round(price * 100)

    if (!Number.isSafeInteger(priceCents)) return false

    if (
        Math.abs(
            price - priceCents / 100
        ) > 0.0000001
    ) {
        return false
    }

    const tickCents = getTickCents(priceCents)

    return priceCents % tickCents === 0
}

export function getDailyPriceLimits(stock) {
    const referenceCents =
        Math.round(stock.referencePrice * 100)

    const minimumTickCents =
        getTickCents(referenceCents)

    const tenPercentCents =
        referenceCents / 10

    let limitUpCents
    let limitDownCents

    if (tenPercentCents < minimumTickCents) {
        limitUpCents =
            referenceCents + minimumTickCents

        limitDownCents = Math.max(
            1,
            referenceCents - minimumTickCents
        )
    } else {
        limitUpCents = Math.floor(
            referenceCents * 11 / 10
        )

        while (
            limitUpCents > 0 &&
            limitUpCents %
                getTickCents(limitUpCents) !== 0
        ) {
            limitUpCents--
        }

        limitDownCents = Math.ceil(
            referenceCents * 9 / 10
        )

        while (
            limitDownCents %
                getTickCents(limitDownCents) !== 0
        ) {
            limitDownCents++
        }
    }

    return {
        limitUp: limitUpCents / 100,
        limitDown: limitDownCents / 100
    }
}

