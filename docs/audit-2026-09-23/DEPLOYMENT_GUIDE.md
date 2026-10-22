# PingPong — Deployment & Configuration Guide

## A. GitHub Upload
1. `cd pingv6 && git init && git add . && git commit -m "Production-ready release"`
2. Double-check before pushing: `git status --ignored` — confirm `.env`, `android/local.properties`, `*.jks`/`*.keystore` are NOT staged (already in `.gitignore`).
3. Create the GitHub repo, then `git remote add origin <url> && git push -u origin main`.
4. In GitHub repo Settings → Secrets and variables → Actions, add any CI secrets you need (e.g. `PINGPONG_KEYSTORE_*` if you build the APK via CI). Never put real secrets in the repo itself.

## B. Railway — Project Creation & Database
1. New Project → Deploy from GitHub repo → select your pushed repo.
2. Add a **PostgreSQL** plugin (Railway provisions `DATABASE_URL` automatically) and a **Redis** plugin (`REDIS_URL`).
3. Railway auto-detects the `Dockerfile`. Confirm the build uses it (Settings → Build → Dockerfile).
4. Set the start command if not picked up from `CMD`: `node scripts/start-production.js`.

## C. Railway Environment Variables (complete checklist)
Set these in Railway → Variables (values are yours — never share them with me or commit them):
```
NODE_ENV=production
PORT=                      # Railway sets this automatically — do not override
DATABASE_URL=              # from the Postgres plugin, auto-injected
REDIS_URL=                 # from the Redis plugin, auto-injected
PUBLIC_APP_URL=            # your Railway domain or custom domain
CORS_ORIGINS=              # same domain(s), comma-separated if multiple

ADMIN_USERNAME=
ADMIN_PASSWORD=

VOICE_MODE=mesh            # switch to "sfu" only after LiveKit is configured AND smoke-tested
TURN_URL=
TURN_USERNAME=
TURN_CREDENTIAL=
TURN_SECRET=
TURN_REALM=pingpong
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

OTP_TEST_MODE=false        # MUST be false in production
SMS_GATEWAY_COMMAND=

META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_BUSINESS_ACCOUNT_ID=
WHATSAPP_API_VERSION=
WHATSAPP_VERIFY_TOKEN=

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=      # keep the literal \n escaping Firebase exports with

S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

GOD_POWER_CODE=
METRICS_TOKEN=
```

## D. Meta / WhatsApp Business API Setup
1. Meta for Developers → your Business App → WhatsApp → API Setup.
2. Copy the **Phone Number ID** and **WhatsApp Business Account ID** into `META_PHONE_NUMBER_ID` / `META_BUSINESS_ACCOUNT_ID`.
3. Generate a **permanent** access token (System User token, not the 24h temporary one) → `META_ACCESS_TOKEN`.
4. Set your webhook URL to `https://<your-domain>/<your-whatsapp-webhook-path>` and `WHATSAPP_VERIFY_TOKEN` to a random string you choose (also enter the same string in Meta's webhook verification field).
5. Test with Meta's API test console before relying on it in the app.

## E. Firebase Configuration
1. Firebase Console → Project Settings → Service Accounts → Generate new private key (JSON).
2. From that JSON, set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` in Railway. Never commit the JSON file itself.
3. The `apiKey` already in `public/firebaseClient.js` is the public web config key — no action needed there, it's meant to be visible.

## F. Database Backup & Migration Safety
1. **Before any migration**, take a Railway Postgres backup: Railway dashboard → Postgres plugin → Backups → trigger a manual backup (or `pg_dump $DATABASE_URL > backup-$(date +%F).sql` from a machine with the URL).
2. Run `npm run db:migrate` — it only uses additive `CREATE TABLE IF NOT EXISTS` style statements (verified: no DROP/TRUNCATE in the migration scripts).
3. After migration, verify record counts didn't drop: `SELECT count(*) FROM users;` before vs after should match (or grow).
4. `npm run db:migrate-json` handles legacy JSON → Postgres migration — run once, then verify a handful of known user IDs/balances match the old JSON files before decommissioning the JSON fallback.

## G. Domain
1. Railway → Settings → Domains → add your custom domain, point its CNAME per Railway's instructions.
2. Update `PUBLIC_APP_URL` and `CORS_ORIGINS` to match the final domain, redeploy.

## H. Post-Deploy Production Testing (do this yourself, live)
Follow the smoke-test flow from your own spec: signup → OTP → login → profile → room join → seat join → voice → chat → gift → wallet update → level/XP → logout → login again → verify persistence. Then restart the Railway service and repeat login to confirm the same user/ID/level/wallet/gift-history survive the restart.
