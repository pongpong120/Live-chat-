# PingPong gateway payments (PhonePe + Cashfree)

Status: **code complete, offline-tested, NOT verified live.** No merchant credentials were available, so no
real PhonePe or Cashfree sandbox/production call has been made. Do not treat either provider as live until the
sandbox procedure below passes with your own merchant account.

## Packages (single trusted source: `payments/packages.js`)
| Package | Price | Diamonds |
|---|---|---|
| Starter Pack | ₹100 | 1,000,000 |
| Popular Pack | ₹250 | 2,600,000 |
| Premium Pack | ₹500 | 5,200,000 |
| Mega Pack | ₹1,000 | 11,200,000 |

The client sends only a `packageId`. Price, paise amount and diamonds are always read server-side. The same list is used by
PhonePe, Cashfree and the manual UPI flow (`wallet/rechargeService.js` falls back to it for `pkg_fixed_*` ids).

## Architecture
- `payments/paymentService.js` provider-independent: `createPaymentOrder`, `getPaymentStatus`, `verifyWebhook/handleWebhook`, `processSuccessfulPayment`, `cancelOrExpireOrder`, `reconcile`.
- `payments/providers/phonepe.js`, `cashfree.js` adapters. `payments/stateMachine.js` states CREATED/PENDING/SUCCESS/FAILED/CANCELLED/EXPIRED; FAILED/CANCELLED/EXPIRED can only become SUCCESS through a *verified* provider status.
- A webhook is only an authenticated trigger. Diamonds are credited only after the service re-fetches the status from the provider and amount, currency and order id match the stored order.
- `payments/stores/pgStore.js` (Postgres, required for automatic payments in production) and `memoryStore.js` (tests/non-production).
- `payments/walletAdapter.js` credits `users.json` idempotently per order id (`paymentCredits.json`), writes the existing diamond transaction log, pushes the wallet update and records SVIP recharge like the manual flow.
- Routes: `GET /api/payments/config`, `POST /api/payments/order`, `GET /api/payments/order/:id`, `POST /api/payments/order/:id/cancel`, `POST /api/payments/webhook/:provider` (raw body captured in `server.js`), `GET /api/payments/health`.
- Existing manual UPI/UTR admin-approval flow is untouched and remains the active mode until `PAYMENTS_AUTO_ENABLED=true` and the config validates.

## Known limitation (must read)
Wallet balances live in single-process JSON (`users.json`). Automatic crediting is therefore only safe with **exactly one app instance**.
Startup refuses to enable automatic payments unless `PAYMENTS_SINGLE_INSTANCE_ACK=true`, `DATABASE_URL` is set (production) and
`PUBLIC_BASE_URL` is https. The smallest safe fix to scale out later is moving `users.diamonds` crediting into the Postgres wallet ledger
(`integration_update/module4_wallet_ledger`) inside the same transaction as the payment row.
Crash ordering: the credit record is written before the balance, so a hard crash can leave a visible gap (record, no balance), never a double credit.

## Environment variables (placeholders in `.env.example`; real values only in Railway Variables)
`PAYMENTS_AUTO_ENABLED, PAYMENT_PROVIDER, PUBLIC_BASE_URL, PAYMENTS_SINGLE_INSTANCE_ACK, PAYMENT_ORDER_TTL_SECONDS,`
`PHONEPE_ENABLED, PHONEPE_ENVIRONMENT, PHONEPE_CLIENT_ID, PHONEPE_CLIENT_VERSION, PHONEPE_CLIENT_SECRET, PHONEPE_WEBHOOK_USERNAME, PHONEPE_WEBHOOK_PASSWORD,`
`CASHFREE_ENABLED, CASHFREE_ENVIRONMENT, CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, CASHFREE_API_VERSION, CASHFREE_WEBHOOK_SECRET (optional).`
Provider endpoints, header names and signature formats in the adapters were written from the provider docs by an earlier session (2026-10-14).
They have not been re-checked or executed here: re-verify against the current PhonePe and Cashfree documentation before the sandbox run.

## Database migration / rollback
- Apply: `npm run db:migrate` (now includes `db/migrations/003_payments.sql`; additive, `IF NOT EXISTS`, touches no existing table, user or balance).
- Rollback (manual, drops payment audit tables only; export first): `psql "$DATABASE_URL" -f db/migrations/003_payments.down.sql`. Diamonds already credited stay credited.
- `pgStore.js` has never been run against a real Postgres. Run the sandbox procedure on a staging database first.

## Railway
1. Add PostgreSQL, set `DATABASE_URL`; keep **1 replica**. 2. Set variables above (sandbox values first). 3. `PUBLIC_BASE_URL` = your https Railway/custom domain.
4. Register webhook URLs: `https://<domain>/api/payments/webhook/phonepe` and `/cashfree`. 5. Check `GET /api/payments/health` (non-sensitive: mode, store kind, configured flags).
6. Logs contain order ids and reasons only, never secrets.

## Dashboard setup
**PhonePe (Payment Gateway, Standard Checkout):** PhonePe must onboard your business and issue merchant credentials (Client ID, Client Version, Client Secret). In the
business dashboard create a webhook with a username/password (put them in `PHONEPE_WEBHOOK_USERNAME/PASSWORD`) pointing to the URL above and subscribe to checkout order completed/failed events.
A plain personal UPI ID does not give you an automatic confirmation API. A UPI deep link/QR stays "manual payment" and needs admin approval.
**Cashfree:** complete business KYC/activation for production; sandbox works first. Copy App ID/Secret into `CASHFREE_CLIENT_ID/SECRET`. Whitelist your domain for the JS checkout (Cashfree dashboard),
enable Webhooks (payment success/failed) with the URL above, and confirm the API version string. Cashfree signs webhooks with the same secret key (HMAC-SHA256 of timestamp+raw body, base64).

## Sandbox-first procedure
1. Staging Railway + staging DB, migrate. 2. Sandbox credentials, `PAYMENTS_AUTO_ENABLED=true`, `PAYMENT_PROVIDER=phonepe` (or cashfree), ack variable true.
3. In the app, buy each of the 4 packages with a sandbox test payment; confirm exact diamonds, one `transactions` entry, one `payment_orders` row `SUCCESS/CREDITED`.
4. Replay the webhook (provider dashboard resend) and confirm no second credit. Test cancel/fail paths. 5. Only then switch the environment variables to production credentials.

## Enable Cashfree later (owner checklist)
1. Finish Cashfree activation and note App ID / Secret. 2. Railway Variables: `CASHFREE_ENABLED=true`, `CASHFREE_ENVIRONMENT=sandbox`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, confirm `CASHFREE_API_VERSION`.
3. Dashboard: whitelist domain, add webhook `https://<domain>/api/payments/webhook/cashfree`. 4. Set `PAYMENT_PROVIDER=cashfree`, redeploy, run the sandbox procedure.
5. Set `CASHFREE_ENVIRONMENT=production` with production keys only after step 4 passes. Switch back any time with `PAYMENT_PROVIDER=phonepe`; PhonePe keeps working while Cashfree is disabled.
Note: Cashfree orders need the user's 10-digit mobile (taken from the logged-in account).

## Tests
`node test/paymentsGateway.test.js` (76 assertions, fake provider HTTP) and `npm test` (whole suite). They prove our logic only, not a live merchant account.
