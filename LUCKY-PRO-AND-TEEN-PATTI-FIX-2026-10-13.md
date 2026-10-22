# Lucky Pro integration + Teen Patti Hot Seat fix

## Changes in this update
- Teen Patti Top 1 / Top 2 / Top 3 are now rendered from the current server round's real bets, sorted by each user's total stake in that round.
- Names and profile image URLs are taken from the real user profile; hard-coded sample names and Unsplash sample avatars have been removed.
- Empty seats show `Waiting…` instead of pretending sample players are betting.
- Teen Patti `/api/teen-patti/state` now returns `hotSeats` alongside the existing game state.
- Existing game tiles and game routes remain in place; no legacy game route was replaced.

## Validation performed
- `node --check games/teenPattiServer.js` passed.
- `node --check server.js` passed.
- Inline JavaScript in `public/games/teen-patti/index.html` passed `node --check`.
- `npm test`: 65/65 suites passed in the available environment.

## Production deployment checks still required
A ZIP cannot be certified as live-production-ready without the target Railway environment. Before enabling real stakes, run `npm install`, `npm run preflight`, `npm run production:check`, and authenticated end-to-end tests against the actual production database/wallet. Confirm persistent shared round-history storage for multiple instances, wallet debit/credit idempotency and payout reconciliation, user-ID mapping, profile image URL accessibility, and restart/concurrency behavior. No production database or account was accessed or changed during this packaging step.
