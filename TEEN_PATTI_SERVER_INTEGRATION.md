# Teen Patti server integration (2026-10-12)

## What changed

- Teen Patti is still opened from Shop, but its client no longer invents an 80,000,000 Diamond balance or calculates card results locally.
- The game requests `/api/teen-patti/state` and places bets through authenticated `POST /api/teen-patti/bet` requests using the existing PingPong session token (`pp_auth_token`).
- The server shuffles a 52-card deck using Node's cryptographic random generator, deals the three hands, evaluates the winner, and closes the round on the server.
- Accepted bets debit the authenticated user's Diamond wallet on the server. If the production wallet ledger is enabled, its debit/credit functions are used; otherwise the existing local JSON wallet is used. Winning bets are paid at the existing UI rule of 2.9x, and wallet updates/transaction records are emitted through the existing PingPong helpers.
- Recent round winners are saved to `data/teen_patti_rounds.json`. Credentials are not bundled in this ZIP. `.gitignore` excludes `private/` and service-account JSON files.
- The display ranking uses recorded server-side bets rather than the previous fake random players and balances.

## Important limitations

- The ranking screen is a play-volume leaderboard only. No Ranking Jackpot prize is reserved or paid because no approved jackpot prize rules/amounts were supplied.
- Current round state and the in-memory leaderboard are owned by one Node process. For a horizontally scaled/multi-instance production deployment, a shared PostgreSQL/Redis round coordinator and durable leaderboard are still required before treating cross-instance gameplay as production-ready.
- Run the game while signed in to PingPong. A direct unauthenticated browser visit should not place bets.
- Firebase Admin initialization uses the service-account path provided by `GOOGLE_APPLICATION_CREDENTIALS`; a credential file alone does not make Firebase client sign-in providers enabled. Verify the server startup log for the Firebase Admin initialized message and test a real sign-in.
