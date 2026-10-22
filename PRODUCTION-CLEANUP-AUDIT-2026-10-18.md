# Production cleanup audit — 2026-10-18

## Changes in this cleanup
- Removed dead example production-domain values from `.env.example`; `PUBLIC_APP_URL`, `CORS_ORIGINS`, and `PUBLIC_BASE_URL` are intentionally blank until the operator supplies the real HTTPS domain.
- Replaced Android build documentation's dead domain with an explicit `YOUR_REAL_HTTPS_DOMAIN` marker.
- Updated the quick-start README to use `npm ci` / `npm start` and removed the unsafe/inaccurate `admin/admin123` login claim. Operators must configure `ADMIN_USERNAME` and a strong `ADMIN_PASSWORD`.
- Preserved the provider-neutral SMS gateway interface and existing local Termux / WhatsApp / HTTP modes. No real SMS provider credentials or deployment URLs were invented or embedded.

## Verification performed in this environment
- `node test/run-all.js`: **76/76 suites passed**.
- JavaScript syntax check: **270 JavaScript files checked; no syntax errors**.
- The test run logged expected warnings because external services/dependencies such as Redis, LiveKit, and optional QR generation were not configured/installed in this sandbox.

## Still required before calling this production-ready
- Set real domain/CORS values and strong secrets in the deployment's secret manager.
- Configure and test a real SMS/OTP provider; this package cannot prove delivery without provider credentials and a real destination.
- Configure PostgreSQL/Redis and run migration/backup/restore drills against the target deployment.
- Configure LiveKit/TURN if using production SFU voice and verify from real mobile networks.
- Run a deployment-specific smoke test, security review, and load test. This archive was not deployed to Railway and no external provider credentials were available, so live production readiness cannot be certified from local tests alone.
