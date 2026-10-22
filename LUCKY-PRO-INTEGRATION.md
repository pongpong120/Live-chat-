# Lucky Pro integration

- Added as a separate `Lucky Pro` tile and iframe sheet. The existing Lucky Fruit/FOODWHEEL entry and other games are retained.
- Client HTML: `public/games/lucky-fruit/index.html`; supplied fruit artwork: `public/games/lucky-fruit/assets/`.
- Launcher artwork: `public/images/game-hub/lucky-pro.png`.
- Server API: `GET /api/lucky-fruit/state`, `POST /api/lucky-fruit/spin`.
- Server logic: `games/luckyFruitServer.js`; rounds are persisted to `data/lucky_fruit_rounds.json`.
- Authenticated server wallet is the source of truth. The browser does not grant balances or choose the winning fruit. Bet debit and payout credit are server-side, with per-user spin serialization and unique transaction IDs. Wallet/payout failures fail closed and are recorded for reconciliation.
- Ranking, history, and winners are generated only from persisted server rounds. No seed/demo players or sample rounds are included. Winner avatar is taken from the actual user's profile fields when available.
- Existing game routes and the legacy `/foodwheel/` game were not replaced.

## Deployment checks before enabling for real users
1. Install dependencies and run `npm test`.
2. Run `npm run preflight` and ensure the production wallet/database is configured and session authentication works.
3. Confirm the `data/` directory is persistent if JSON fallback storage is used. For multi-instance production, use the existing shared production wallet/database and persistent/shared round-history storage; local JSON history is not cross-instance.
4. Test with a designated test account: insufficient balance, repeated/parallel spin requests, payout failure handling, restart persistence, avatar rendering, and wallet transaction reconciliation.
5. The game uses the app's in-app Diamonds wallet. This change does not create cash deposits, cash withdrawals, or cash-out functionality.
