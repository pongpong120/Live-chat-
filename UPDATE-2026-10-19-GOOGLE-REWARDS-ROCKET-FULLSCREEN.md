# Update — 2026-10-19

## Included changes
- Login UI exposes Google sign-in only; Facebook button and client handler removed. Firebase login API rejects Facebook provider tokens.
- Server-authoritative seven-day daily diamond reward schedule: 60,000; 60,000; 120,000; 120,000; 120,000; 120,000; 380,000.
- Rocket Crash modal and iframe fill the viewport, request browser fullscreen when supported, and include safe-area-aware close control.
- Rocket Crash diamond indicators now use `public/images/icons/icon-diamond-premium.png`, matching the main app asset, with translucent/glowing HUD polish.
- Cache-busting versions updated for Google-only auth, daily reward changes, and Rocket Crash fullscreen UI.

## Validation performed
- `node --check server.js`
- `node --check public/app.js`
- `node --check public/firebaseClient.js`
- `node test/dailyDiamondReward.test.js`
- `node games/rocketCrash.safety.test.js`
- `node test/run-all.js` (77/77 suites passed)

Full device/browser testing, deployed Firebase provider settings, and Play Store release signing remain deployment/release tasks.
