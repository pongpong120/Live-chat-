# PingPong Source Audit & Safe Cleanup — 2026-10-13

## Scope

This audit was performed on the supplied `PingPong-GOD-POWER-CONTROL-PANEL-FIX-2026-10-13.zip` in a separate working copy. The original archive was not modified. Changes were limited to verified source hygiene and two low-risk server hardening fixes; game rules, wallet calculations, payouts, room logic, and UI behavior were not intentionally changed.

## Changes applied

1. **Removed runtime/session artifacts from the source release:** `data/tokens.json` and `data/ai_logs.jsonl`. The included token file contained active-session-shaped entries and must not be distributed as source. The application will create its token file at runtime when needed. Existing users' sessions may need to log in again if this clean copy replaces an instance; production session data should be migrated deliberately, not copied into source control.
2. **Removed machine-specific Android config:** `android/local.properties` referenced a machine/deployment-specific URL and should be generated per build environment. The project retains its example configuration.
3. **Hardened Git ignore rules** for generated JSON/JSONL/temp/backup files under `data/`, reducing the risk of accidentally committing runtime records.
4. **Removed real WhatsApp identifiers from `.env.example`** and replaced them with setup placeholders. Actual values belong in deployment variables.
5. **Made static directory mounts independent of the process working directory** by resolving `public/` and `admin/` from `__dirname`. This helps avoid path-related differences between Termux and a hosted runtime.
6. **Fixed global error-handler status behavior:** unexpected errors now default to HTTP 500 instead of being incorrectly labeled HTTP 400; production 5xx responses return a generic message rather than exposing internal error text. Server-side diagnostics remain logged.
7. **Pinned the supported Node major line** to Node 22.x in `package.json` and added `.nvmrc` to reduce local/host runtime drift.

## Validation results

- `node scripts/production-preflight.js`: PASS — 252 JavaScript files passed syntax checks and required deployment files were present.
- `npm test`: PASS — 72/72 test suites passed after the source changes.
- Production integration checks against live Railway, PostgreSQL, Redis, LiveKit/TURN, SMS, and real multi-user traffic were **not** possible in this environment.

## Remaining release blockers / risks

1. **No `package-lock.json` was present in the supplied ZIP.** Attempting to generate one could not complete because package registry access was unavailable and the offline npm cache did not contain all packages. Do not fabricate a lockfile. Generate and commit a real lockfile in an environment with registry access, then validate with `npm ci` and rerun all tests before treating installs as reproducible.
2. **Production service verification remains outstanding.** The local test suite does not prove live Railway, persistent storage, PostgreSQL, Redis, LiveKit/TURN, or multi-instance correctness.
3. **Asset cleanup needs runtime verification.** A literal-reference scan found 53 image/media files without a direct filename match in source text. Several are likely resolved dynamically (for example fruit assets, chest levels, level-tier badges, and themes). They were deliberately retained because deleting them without validating dynamic paths could break gameplay/UI. Review `docs/ASSET-REFERENCE-REVIEW-2026-10-13.txt` before removing any.
4. The Firebase web API key in `public/firebaseClient.js` is client-visible configuration, not a server secret by itself. Verify Firebase authorized domains, API restrictions, and database/storage security rules in the Firebase console.
5. The project includes voice configuration that defaults to mesh unless configured otherwise. Do not switch production to SFU without valid LiveKit credentials and a real voice smoke test.

## Release recommendation

This is a safer, cleaner source copy with validated local regression tests, **not a guarantee of zero bugs or full production readiness**. Before deployment, create a real lockfile, configure Railway variables, run the production preflight and tests, deploy to a staging service, then test game rounds, balance changes, reconnects, audio shutdown, and admin permissions using test accounts and non-production balances. Keep the previous deployment available for rollback.
