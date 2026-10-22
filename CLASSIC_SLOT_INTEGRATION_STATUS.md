# Classic Slot server integration — 2026-10-13

- Lucky Slot remains available from the Room Games Hub in the existing isolated same-origin iframe.
- Added authenticated `GET /api/classic-slot/state` and `POST /api/classic-slot/spin` routes in `games/classicSlotServer.js`.
- Slot balance and gameplay require the authoritative production wallet (`productionWallet.enabled()`). If PostgreSQL/wallet authority is unavailable, the API fails closed and does not fall back to localStorage or JSON balances.
- Server validates the line bet, serializes each user's spin requests, generates the 3x3 result using server-side cryptographic randomness, calculates the 5 paylines, debits Diamonds and credits winnings through the production wallet ledger with per-round idempotency keys, and sends the wallet update through the existing PingPong wallet update path.
- Completed rounds are persisted to `data/classic_slot_rounds.json`; state returns ranking and hot-seat aggregates from recorded server rounds. Socket events `classic-slot:round`, `classic-slot:ranking`, and `classic-slot:hot-seats` broadcast round updates.
- Client spin uses server-generated grids and server-reported payout/balance. It blocks gameplay when authentication/server/wallet checks fail and does not use local balance as authority.
- Syntax checks pass for `server.js` and `games/classicSlotServer.js` and the embedded slot scripts.

## Deployment requirements and remaining production verification

- Production must have the existing PostgreSQL wallet enabled and user sessions configured; local JSON-only mode intentionally cannot play this slot game.
- This package has not been exercised against the user's live Railway database/session environment. Before real users stake Diamonds, run the existing production preflight and end-to-end wallet reconciliation tests, verify user identity mapping in the deployed auth middleware, and verify socket-client rendering of hot-seat/ranking broadcasts. Do not describe the package as fully production-certified until those checks pass.
- A wallet payout failure after a successful debit is logged and recorded for manual reconciliation; support/operations must reconcile such rounds before deployment to users.

## Fix 2026-10-13 (login session expired / Termux)
- Slot client now sends `Authorization: Bearer <pp_auth_token>` (the only token transport `requireUserAuth` accepts); previously it relied on cookies, so every request got 401 "Login session expired".
- Server wallet: uses the PostgreSQL ledger when enabled; otherwise (Termux/local, no PostgreSQL) falls back to the server-side users.json Diamond balance, same as Teen Patti. Still server-authoritative: no demo balance, no localStorage balance, bets/wins debited/credited on the server.
- Verified by simulated spins (JSON wallet mode). Not tested against live PostgreSQL.
