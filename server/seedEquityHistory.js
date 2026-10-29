// Development entry point. Seed generation lives in equityHistorySeed.js.
if (require.main === module) {
    process.env.NIOUSTOCK_SEED_EQUITY = '1'
    require('./index').startServer()
}
