# Lucky Fruit + Classic Slot / Lucky Seven Fixes — 2026-10-13

## Fixed in this update

- Lucky Fruit now posts each chip placement to the authenticated server immediately (`POST /api/lucky-fruit/bet`). The wallet is debited and the bet is persisted as soon as the server accepts it; the round settlement no longer debits those same bets a second time.
- Accepted in-progress Lucky Fruit bets are stored in `data/lucky_fruit_active_bets.json`, returned by the state API, and restored by the page after reload.
- The server rejects a bet if the wallet cannot cover it and caps an active round at 100,000,000 diamonds.
- Lucky Fruit winner-list entries are deduplicated by user ID, so the same user's recent wins do not occupy multiple winner rows.
- Fruit Wheel now locks each round before asynchronous payout settlement begins. The 500ms timer cannot settle/credit the same round repeatedly while wallet credits are pending.
- If a Fruit Wheel settlement fails part-way through, the round is locked for reconciliation rather than automatically retried (which could duplicate a local-wallet payout).
- Fruit Wheel client event handling now rejects stale winner/result packets whose round ID does not match the active round, preventing old win badges and old payout popups from being replayed.
- Lucky Fruit uses a fixed viewport-height layout with compact rules for short screens to reduce page scrolling and fit the board more consistently.
- Classic Slot's server per-line rounding now matches the client evaluation. Added regression checks that the 7/Bell/Diamond/fruit multiplier and RNG-weight tables, payline coordinates, cherry rule and rounding stay aligned.

## Tests run

- `node --check games/luckyFruitServer.js` — PASS
- `node --check games/classicSlotServer.js` — PASS
- Inline JavaScript syntax check for `public/games/lucky-fruit/index.html` — PASS
- `node test/luckyFruitInstantBet.test.js` — PASS (immediate debit, active-bet persistence, settlement and unique winners)
- `node test/classicSlotPayoutParity.test.js` — PASS (client/server payout-table parity)
- `node test/fruitWheelRoundIsolation.test.js` — PASS (duplicate-settlement lock and stale-round packet guards)
- `node test/run-all.js` — PASS, 67/67 suites (existing suite set; new focused Fruit Wheel regression test also run separately)

## Important scope note

This archive's 7-symbol game is implemented as `public/games/classic-slot/` with server logic in `games/classicSlotServer.js`; it does not contain a separately named `Lucky Seven` route. The payout table/paylines in that game were checked and aligned. Tests use a local mocked wallet and do not verify a live Railway/PostgreSQL wallet or real production traffic. Before real-money/production stakes, test with a staging account and reconcile wallet ledger entries against round history.


## Remaining production verification

The complete local test suite passed, but these tests do not prove live Railway/PostgreSQL behavior. A Fruit Wheel round that fails after some wallet credits is intentionally locked and requires audit-ledger reconciliation; it is not automatically retried, to avoid double-crediting. Do not reset production data.
