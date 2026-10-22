# PingPong Party update report — 2026-10-11

## Applied in this update
- Added the supplied rocket-start and rocket-blast WAV sound effects under `public/games/audio/`.
- Added an in-game sound toggle to `public/games/rocket-crash.html`.
- The start sound is triggered when the client observes a new running round; the blast sound is triggered when the server state changes to crashed.
- Updated game copy to describe the displayed balance as virtual game coins, not cash or redeemable funds.
- Preserved the existing project structure and other source files.

## Checks actually run
- `node --check server.js` — PASS
- `node --check games/rocketCrash.js` — PASS
- Inline JavaScript extracted from `public/games/rocket-crash.html`, checked with `node --check` — PASS

## Important unfinished integration work
- The existing `games/rocketCrash.js` uses an in-memory `Map` and starts each player at 12,500 virtual coins. Balances and rounds are not durable across restarts.
- This update does NOT connect Rocket Crash to the PingPong production Diamond wallet and does NOT debit the app's actual wallet. That requires a verified wallet service/schema, authenticated user identity, atomic ledger transactions, idempotency, and concurrency tests; it must not be simulated by changing only the UI.
- Shared rounds are authoritative only within one Node.js process. Multi-instance deployments need shared durable round coordination.
- Group Join/task integration, device-size visual QA, end-to-end login/voice/gift/admin regression tests, and live-server verification were not run as part of this sound-focused patch.
- The full npm test suite was not run because dependencies are not installed in this working copy.

## Termux smoke test
1. Extract the ZIP and enter `pingpong_latest/pingpong_edit`.
2. Install dependencies with `npm install`.
3. Configure a private `.env` using `.env.example`; never place production secrets in the ZIP.
4. Run `npm start`.
5. Open the app and launch Rocket Crash. Tap **Sound On** once (mobile browsers may require a user gesture before audio playback).
6. Confirm the start and crash sounds play when the corresponding server events arrive.

Do not use this build to advertise cash betting, cash winnings, withdrawals, or production-wallet integration.
