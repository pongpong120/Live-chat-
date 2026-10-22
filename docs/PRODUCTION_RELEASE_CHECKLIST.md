# PingPong production release checklist

This repository includes deployment wiring and regression tests, but a successful local test run is not proof of a live production launch. Complete every applicable item before public release.

## Repository and CI
- Use Node.js 22 (matches `.nvmrc`, `package.json`, and the Docker base image).
- GitHub Actions runs syntax/preflight checks and the regression suite on pushes and pull requests.
- The archive must not contain `.env`, service-account private keys, Android signing keys, runtime `data/*.json`, session tokens, or logs.
- This source archive has no lockfile. The first connected CI/build environment should run `npm install --no-audit --no-fund` and commit the generated `package-lock.json`; after that, prefer `npm ci` for repeatable builds.

## Railway server
1. Create a Railway project from the GitHub repository and deploy using the included `railway.json`/`Dockerfile`.
2. Add Railway PostgreSQL and Redis plugins. Keep one application replica until wallet, room state, payment crediting, and cross-instance voice/call flows have been verified against shared storage.
3. Configure required secrets in Railway Variables, never in Git, the APK, or this archive:
   - `NODE_ENV=production`
   - `PORT` (Railway supplies this)
   - `ADMIN_USERNAME`, a unique strong `ADMIN_PASSWORD`, `METRICS_TOKEN`
   - `DATABASE_URL`, `REDIS_URL`
   - `PUBLIC_APP_URL`, `PUBLIC_BASE_URL`, `CORS_ORIGINS` using the real HTTPS domain
   - `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
   - `FIREBASE_SERVICE_ACCOUNT_BASE64` (base64 of the new service-account JSON) or another supported Firebase Admin credential source
   - `OTP_TEST_MODE=false` and a real configured SMS/OTP provider
   - `VOICE_MODE=sfu`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; configure TURN/relay as required by the selected LiveKit deployment
4. Run database migrations (`npm run db:migrate`) and verify backup/restore on a staging database.
5. Confirm Railway health check `GET /healthz` succeeds. Then verify `GET /api/production/health`, logs, Firebase login, OTP delivery, room join/leave, reconnect, and multi-user voice from multiple mobile networks.
6. Do not enable automatic payments until provider sandbox tests, webhook signature validation, duplicate webhook replay, cancellation/failure, and exact wallet-credit reconciliation all pass. Use the current `docs/PAYMENTS_GATEWAY.md` procedure. Real merchant credentials and legal/business approval are external prerequisites.

## Voice and scaling
- The current default is `VOICE_MODE=mesh`; that is not the production multi-party SFU configuration.
- Only switch to `VOICE_MODE=sfu` after LiveKit credentials exist and `npm run preflight:agora`/the relevant SFU validation scripts plus real device tests pass.
- Verify room isolation, subscribe/publish permissions, reconnect, microphone permission denial, background/resume, Bluetooth, mobile data ↔ Wi-Fi switching, and at least the target peak participants per room.
- Add Redis before multiple Railway replicas; test cross-instance socket events and room state. A passing unit test does not substitute for a multi-instance staging run.

## Android / Play Store
- Android package ID: `com.pingpong.rocket`; current version in Gradle is `2.2.0` / versionCode `8`.
- Set `WEB_APP_URL` to the deployed HTTPS app URL for Android builds; never ship `localhost`.
- Build a local test APK with `cd android && ./gradlew assembleDebug`.
- For a Play release, use a real protected upload keystore and set `PINGPONG_KEYSTORE_FILE`, `PINGPONG_KEYSTORE_PASSWORD`, `PINGPONG_KEY_ALIAS`, and `PINGPONG_KEY_PASSWORD`. The repository's auto-generated local development keystore is test-only and must not sign a Play Store release.
- Build the bundle with `./build-android-release.sh` only after real release signing variables are configured. Test on real devices and complete Play Console privacy, data safety, account deletion, target API, content rating, and app access forms.

## UI
- The `premium-polish-2026-10-19.css` layer adds subtle motion, glass depth, focus states, and reduced-motion support without changing app business logic.
- Test on small Android screens, landscape, slow networks, reduced-motion settings, and screen readers. Check every primary flow after CSS changes.

## Current limitations
- No deployment was performed by this archive update; no GitHub/Railway account was connected.
- No live Firebase login, SMS delivery, LiveKit voice, payment gateway, Postgres/Redis production migration, or Play Store release can be certified without the operator's credentials and staging tests.
- Automatic payment documentation explicitly identifies legacy JSON wallet storage as a single-instance limitation. Do not scale payment-crediting across replicas until the shared Postgres ledger is the authoritative credit path.
