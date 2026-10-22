# Daily Diamond Reward — 2026-10-13

- Added a responsive, premium seven-day Daily Reward modal inspired by the supplied reference image.
- Reward values are 6,000; 6,000; 12,000; 12,000; 12,000; 12,000; and 18,000 diamonds.
- Uses the existing `public/images/icons/icon-diamond-premium.png` asset rather than coin artwork or decorative reward frames.
- Added authenticated server endpoints for reward state and claiming. The server is authoritative for the day, prevents duplicate same-day claims, credits `user.diamonds`, and saves a bounded claim history.
- Daily streak continues when claimed on consecutive India-calendar days; missing a day starts again at Day 1. Day 7 loops to Day 1 on the next day.
- Added `test/dailyDiamondReward.test.js`.

## Verification
- `node --check server.js` — passed.
- `node --check public/app.js` — passed.
- `node test/classicSlotPayoutParity.test.js` — passed.
- `npm test` — 68/68 suites passed before adding the focused daily reward contract test.
