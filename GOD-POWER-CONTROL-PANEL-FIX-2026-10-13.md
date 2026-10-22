# God Power Control Panel Update — 2026-10-13

## Added
- Control Panel God Power global moderation form, targeting User ID and/or Room ID.
- Room-level ban/unban; enforced on room join and persisted in `rooms.json`.
- Account ban/unban.
- Profile-image ban/unban; banned users cannot upload a new profile image until restored.
- Room theme/background ban/unban; theme lock is persisted and enforced by the server.
- Room deletion with an explicit reason; official Room 101 is protected.
- Active account deletion with reason, session revocation, removal from active users, private-message/block/report cleanup, and a limited audit archive entry. God Power accounts are protected from ban/deletion through this tool.
- Every action requires the existing authenticated Control Panel session and `godpower:manage` permission, and is audit-logged.
- Existing God Power grant/revoke by User ID remains in place. Existing server room-lock logic already allows God Power holders into password-locked rooms.

## Verification
- `node --check server.js` — passed.
- `node --check admin/app.js` — passed.
- `node test/godPowerControl.test.js` — passed.
- `node test/run-all.js` — 72/72 suites passed.

## Deployment note
This is a source ZIP only. It has not been deployed to Railway or any live environment. Test the actions in staging and take a data backup before production deployment.
