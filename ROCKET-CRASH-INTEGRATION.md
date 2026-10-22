# Rocket Crash integration
- Room → More → Rocket Crash opens the game as an in-app modal (iframe `/games/rocket-crash.html`).
- The iframe does not open its own socket; `public/app.js` bridges `rocket:*` events over the app's authenticated socket.
- Server logic: `games/rocketCrash.js` (initialised in `server.js` after `productionWallet`). Env: `ROCKET_MAX_BET`, `ROCKET_HOUSE_EDGE`.
