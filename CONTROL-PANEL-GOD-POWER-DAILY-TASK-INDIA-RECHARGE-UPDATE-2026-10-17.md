# PingPong Control Panel, God Power, Daily Task and India Recharge Update

## Changes included

- Fixed Daily Diamond Reward authentication identity resolution: the API now derives the user ID from the authenticated session's mobile key instead of reading `req.authedUserId` / `req.user`, which the current auth middleware does not populate.
- Fixed the Daily Reward history date reference, safely clamps the diamond balance, records the wallet transaction, and keeps claim history server-authoritative.
- Added a premium Daily Task popup shortcut beside the room's Group indicator. It uses the project's diamond asset, shows the complete 7-day reward schedule, displays current eligibility, and claims through the authenticated server endpoint.
- Removed placeholder “Join a room” and “Social activity” rows that were marked available without server-backed reward claims. The screen now presents only the actual check-in reward and real room-owner bonus.
- Corrected the room-owner gift bonus calculation to use 200 basis points / 10,000 = 2%. The prior divisor incorrectly calculated 200% of eligible gift spend. The bonus accrues from validated socket gifts and the REST gift endpoint, remains pending during the India-local day, and is settled by the server at day rollover.
- Added Control Panel user inquiry details for account status, country, balances, moderation flags, wallet transactions, recharge transactions, gift history and owned rooms. Inquiry access is country-scoped and audit-logged.
- Added God Power actions to block/unblock SMS/OTP and system notifications. SMS/OTP requests now reject accounts with `smsBlocked`; system-generated notifications respect `notificationsBlocked`. These actions are audit-logged and country-scoped.
- Kept existing role-based admin account creation and per-feature permissions; existing server-side permission checks remain authoritative.
- Restricted both manual UPI recharge endpoints and automatic PhonePe/Cashfree gateway endpoints to completed India profiles (`country === "IN"`). Non-India accounts receive no online packages and online order/payment/UTR operations are rejected server-side; the UI explains that those accounts must use the authorized offline Admin/Merchant route.
- Updated contract tests for the corrected Daily Reward flow and added God Power / country-recharge / room-bonus coverage.

## Verification

- `npm test`: **76/76 suites passed** after the changes.
- `npm run preflight`: **270 JavaScript files syntax-clean** and required deployment assets present.
- `node --check` passed for the modified server, public app, admin app, payments module and focused tests.
- The separate `npm run production:check` could not run in this packaging sandbox because dependencies were not installed (`dotenv` missing). Run `npm install` in the target Termux/deployment environment before production checks.

## Deployment / production notes

- This ZIP is the complete source project, not a live deployment. Live Firebase credentials, production database/Redis configuration, SMS gateway hardware permissions, payment-provider credentials/webhooks, and multi-instance wallet settlement must be verified in the target environment.
- Runtime session tokens and generated log files are intentionally excluded from the release archive. The project `.gitignore` already excludes these files.
- Online payment is not represented as automatically verified unless the configured provider's authenticated verification flow confirms it. The existing manual UPI recharge flow still requires Admin approval.
