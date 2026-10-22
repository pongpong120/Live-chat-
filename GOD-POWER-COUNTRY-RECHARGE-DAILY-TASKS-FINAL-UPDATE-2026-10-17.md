# PingPong Control Panel / Daily Tasks / Country Recharge Update — 2026-10-17

## Changes included

- Made the existing **God Power / Super Admin** section reachable from the Control Panel sidebar, permission-gated by `godpower:manage`.
- Made **Admin Accounts & Permissions** reachable in the sidebar, permission-gated by `role:manage`; the existing owner-only account creation and per-permission assignment API remains the authority.
- Added a complete User Inquiry view to God Power: profile/country, wallet transaction rows, recharge history, confirmed gift activity (sent and received), owned rooms, and current moderation flags. Inquiry is country-scoped and audit-logged.
- Exposed SMS/OTP block/unblock and system-notification block/unblock actions in the God Power UI. The server requires a reason for block/destructive actions, applies country-scope checks, persists flags, and respects notification blocking for system inbox notifications.
- Kept room/account moderation actions server-authorized and audit-logged; added country-scope checks for relevant user and room actions.
- Restricted online UPI recharge configuration and online order/payment/UTR/cancel endpoints to accounts whose selected ISO country is `IN`. Non-India accounts receive an empty online package list and an offline-recharge-only notice. Existing authorized offline admin/merchant flows are not removed.
- Fixed the Daily Task entry flow so the Daily Tasks page button opens the single dedicated Daily Task popup rather than triggering a claim at the same time as opening another modal. The claim remains server-authoritative.
- Added the Daily Task shortcut in the group-detail modal and retained the compact room-header Group/Daily Task shortcut.
- Kept room-owner gift bonus at 2% of eligible real gift spend, settled into the room owner's diamond wallet at India-time day rollover.

## Validation performed

- `node --check` passed for all JavaScript files in the project (excluding dependency directories).
- `npm test` completed with **76/76 suites passed** on the successful final run.
- `node test/premiumGodPowerCountryDailyTask.test.js` passed.

## Production caveats

This package has passed local source/suite checks, but no claim is made that live Firebase credentials, production UPI/payment provider credentials, Redis/PostgreSQL availability, multi-instance locking, or real-money settlement have been verified in this environment. Run the project's production preflight/readiness commands with the deployment's real environment variables before production rollout. The user-facing online UPI flow remains manual UTR verification unless a separate configured gateway is enabled.
