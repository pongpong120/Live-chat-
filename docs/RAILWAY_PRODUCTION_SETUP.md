# Railway production setup

Use this checklist with `railway.json`, `Dockerfile`, and `PRODUCTION_RELEASE_CHECKLIST.md`. A Railway deploy is not production-ready until the real providers and mobile-device flows are verified.

## Required Railway Variables

- `NODE_ENV=production`
- `ADMIN_USERNAME` and a unique, strong `ADMIN_PASSWORD`
- `METRICS_TOKEN` (required by the production config contract)
- `DATABASE_URL` (Railway PostgreSQL)
- `REDIS_URL` (Railway Redis)
- `PUBLIC_APP_URL`, `PUBLIC_BASE_URL`, and `CORS_ORIGINS` set to the real HTTPS domain
- `STORAGE_PROVIDER=s3` plus `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `OTP_TEST_MODE=false` and a real SMS/OTP provider configuration
- `FIREBASE_SERVICE_ACCOUNT_BASE64` containing the base64-encoded service-account JSON, or another credential source supported by `security/firebaseAuth.js`
- For multi-user production voice: `VOICE_MODE=sfu`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and any required TURN/relay configuration

Set secrets in Railway Variables, never in source, an Android APK, or a committed `.env` file. For Firebase, generate a new service-account key if any old key was shared or exposed, encode it locally, and store the encoded value only as a Railway secret. Do not paste the JSON or private key into chat.

## Deployment steps

1. Push the cleaned project to a private GitHub repository and connect it to Railway.
2. Deploy with the included Dockerfile. Railway uses `/healthz` as the health-check path.
3. Add PostgreSQL and Redis, then run `npm run db:migrate` against the target database before accepting traffic.
4. Verify `GET /healthz`, `GET /api/production/health`, and `GET /api/payments/health`.
5. Run the full regression suite (`npm test`) in CI, then run staging smoke tests for Firebase login, real OTP delivery, multiple users/rooms, voice reconnect, object uploads, backups, and restore.
6. Keep one application replica while the legacy JSON wallet and automatic payment-crediting path are active. Do not scale out payments until the shared PostgreSQL wallet ledger is the authoritative balance source and cross-instance idempotency has been verified.

## Voice

The app defaults to `VOICE_MODE=mesh` when unset. Mesh is not the recommended production topology for many participants. Do not switch to `VOICE_MODE=sfu` until LiveKit variables are present and the SFU validation plus real mobile network tests pass. Production startup intentionally fails fast when SFU mode is selected without LiveKit credentials.

## Automatic payments

PhonePe/Cashfree code is documented in `PAYMENTS_GATEWAY.md` but has not been verified against live merchant credentials in this source-only workflow. Start in sandbox, confirm webhook signatures and status re-fetch, test duplicate webhook replay and failed/cancelled orders, and reconcile the exact wallet credit before enabling production payments. A normal UPI QR/ID alone is not an automatic payment confirmation API.

## Android release

Set `WEB_APP_URL` to the real HTTPS deployment URL. Use a protected release upload keystore and the four `PINGPONG_KEYSTORE_*` variables for Play Store signing. The local development keystore fallback is for local testing only. The manual GitHub Actions workflow can build a debug APK artifact; it is not a Play Store signed release.
