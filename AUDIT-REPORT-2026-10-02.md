# PingPong Production Audit — 2026-10-02

## Verified
- 64/64 project test suites pass after the source changes.
- All JavaScript files pass `node --check`.
- LiveKit SFU authorization and publish-recovery tests pass.
- Existing country/RBAC and Official→Agency inquiry/audit paths are present.
- Fruit Wheel server configuration already supports scale/width/height/vertical offsets.

## Source changes made
- Production login UI is now Google + Facebook only.
- Added Firebase Facebook OAuth provider flow and server-compatible Firebase token handoff.
- Removed OTP/password login controls from the public login surface (legacy server endpoints remain unlinked for migration compatibility).
- Added premium translucent/glow treatment hooks for icon/action surfaces.
- Added Fruit Wheel vertical fine-tune plus/minus control and wired it to the game frame.
- Removed four clearly unreferenced legacy icon assets.
- Added public `/account-deletion.html` and `/privacy-policy.html` landing pages for Play Console/web requirements.

## Production blockers that cannot be honestly verified from this ZIP
- Real Firebase Facebook provider/App ID configuration must be enabled in Firebase/Meta dashboards.
- LiveKit URL/key/secret, TURN, Redis, and production database credentials must be supplied in the deployment environment.
- A real Play Store upload key and release AAB must be produced in a trusted build environment.
- Android build could not be executed here because the Gradle wrapper attempted to download Gradle and this environment has no network access.
- “Voice scanner” is not present as a distinct feature/module in this source tree; LiveKit voice is present and tested.
- Play Console Data Safety, UGC/moderation, privacy URL, account-deletion URL, foreground-service declarations, and app-content declarations still require human completion/review in Play Console.

## Important design note
The project contains many existing features (wallet, gifts, SVIP, agencies, games, AI support, voice, admin RBAC). They were not blindly deleted because doing so could break server contracts and existing user data. Only clearly unreferenced legacy icon files were removed in this pass.

## Follow-up update (2026-10-02)
- Added a profile photo square-crop flow before upload, with zoom adjustment, JPG/PNG/WebP validation, 12 MB client-side limit, WebP output, and cleanup of temporary object URLs.
- Added browser context-menu and drag-save friction for image elements. This is a casual UX deterrent only; client-visible images cannot be made impossible to save or screenshot.
- Agency Event-specific controls were not located in this source tree, so no unverified or disconnected control-panel UI was fabricated. A dedicated feature spec/backend route and role/country permissions are still needed.
- Added a focused static regression test for the crop UI.

## Follow-up update (2026-10-02)
- Profile photo upload now validates allowed raster MIME types and 10MB limit in the browser, normalizes EXIF orientation where supported, center-crops to a 512x512 JPEG, and clears the file input after completion. This is an automatic centered crop; interactive reposition/zoom crop UI is not included in this follow-up.
- Decorative navigation/icon images now suppress browser drag and context-menu gestures to reduce accidental save/drag. This is not asset security: anything delivered to a client can still be captured or retrieved; do not put secrets in public assets.
- Validation after the change: `node --check public/app.js` passed and `npm test` passed all 64/64 suites. These tests do not constitute real-device, live-provider, load, or Play Console verification.
