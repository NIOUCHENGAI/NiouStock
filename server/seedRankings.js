if (require.main === module) {
    process.env.NIOUSTOCK_SEED_RANKINGS = '1'
    process.env.NIOUSTOCK_SEED_MARKET = '1'
    require('./index').startServer()
}
