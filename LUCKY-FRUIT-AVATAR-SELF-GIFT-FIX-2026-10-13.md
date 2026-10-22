# Lucky Fruit Pro — Winning List Avatar + Self-Gifting Fix

## Changes
- Lucky Fruit winner and ranking rows now resolve profile images from the current user record, including `photo`, `profilePhoto`, `profilePic`, `avatarUrl`, and other supported avatar fields. This also repairs older winning records whose saved avatar was empty.
- Winning List and ranking images now use lazy loading and fall back to a person icon if the image URL is broken, instead of leaving an empty/broken image.
- Room gift recipient selection now includes the current user when their own account occupies a room seat, labeled `You — Self Gift`.
- Normal gifts and video gifts both accept the selected self recipient on the server, while keeping the existing rule that recipients must occupy one of the room's 12 seats. Wallet debit/credit and gift history paths remain server-side.
- Profile Name/Bio save continues to preserve and refresh existing language/country settings; those settings were not added to the editor.

## Verification
- `node --check server.js` — PASS
- `node --check games/luckyFruitServer.js` — PASS
- `node --check public/app.js` — PASS
- `node test/luckyFruitInstantBet.test.js` — PASS
- `node test/luckyFruitWinningAvatar.test.js` — PASS
- `node test/roomCapacityAndVideoGift.test.js` — PASS
- `node test/profileCountryFlag.test.js` — PASS
- `node test/run-all.js` — 71/71 suites PASS

No production deployment was performed by this patch.
