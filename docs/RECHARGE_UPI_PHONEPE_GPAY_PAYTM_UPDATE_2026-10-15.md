# PingPong Recharge UPI + Gateway Integration Update — 2026-10-15

## Existing flow preserved
- Existing Recharge package, server-created order, UPI payload, UTR submission, Admin approval and wallet-credit guard remain in place.
- PhonePe, Google Pay, Paytm and Any UPI App are app-launch choices for the same server-configured merchant UPI ID. A deep link is **not** payment proof.
- Manual UPI transactions remain pending / submitted for manual verification; app return or client response never credits diamonds.
- Added Paytm to the existing Admin payment-method settings while retaining older settings compatibility (a missing `paytm` flag remains disabled until saved/enabled).
- The Wallet embedded UI now shows a payment-app chooser and keeps the server-provided amount/reference in the payment URI. Android app intents target the selected app and fall back to generic UPI when the selected app does not open.

## Gateway / Cashfree readiness
The existing `payments/` integration layer supports server-side order creation, server-side status retrieval, raw-body webhook signature verification, order/amount/currency checks and idempotent credit claims. It is **disabled by default**. Do not enable production until the provider merchant account is approved, current provider docs are rechecked, PostgreSQL is configured/migrated, HTTPS/webhook URLs are configured, and sandbox tests pass. The current app wallet adapter uses JSON wallet storage; production auto-payments are intentionally gated to a single instance and require `DATABASE_URL`.

### Server-only environment variables
- `PAYMENTS_AUTO_ENABLED=false` (keep false until sandbox validation)
- `PAYMENT_PROVIDER=cashfree` (`phonepe` or `cashfree`)
- `PUBLIC_BASE_URL=https://your-public-domain`
- `PAYMENTS_SINGLE_INSTANCE_ACK=false` (set true only if intentionally running one instance with current JSON wallet storage)
- `PAYMENT_ORDER_TTL_SECONDS=900`
- `CASHFREE_ENABLED=false`
- `CASHFREE_ENVIRONMENT=sandbox` (`sandbox` then `production` after approval)
- `CASHFREE_CLIENT_ID=`
- `CASHFREE_CLIENT_SECRET=`
- `CASHFREE_API_VERSION=2025-01-01` (confirm the supported version in the Cashfree dashboard/current docs before use)
- `CASHFREE_WEBHOOK_SECRET=` (optional; by default current code uses the PG client secret)
- `DATABASE_URL=` (PostgreSQL; required for production automatic-payment mode)

Never put credentials in frontend files, APK assets, or source control. Register `https://your-public-domain/api/payments/webhook/cashfree` in the Cashfree merchant dashboard. After creating a staging database, run `npm run db:migrate`, configure sandbox credentials in server environment only, and verify the provider's webhook format/signature against the current official documentation before switching on the gateway.

## Testing boundaries
Automated suite after modifications: `npm test` passed, 74/74 suites. Focused recharge checks also passed: `test/rechargeService.test.js` (63 assertions), `test/rechargeAmountPersistence.test.js`, and `test/paymentsGateway.test.js` (76 assertions). `node --check` passed for `public/app.js`, `admin/app.js`, and `wallet/rechargeService.js`. This environment cannot launch Android apps, a real WebView/APK, or make real merchant transactions. No live payment, real Cashfree credentials, merchant onboarding, app-installed/fallback behavior, or device-level testing is claimed here.


## Official Cashfree reference checked for this update
- Cashfree Dev Studio checkout/create-order example shows `POST https://sandbox.cashfree.com/pg/orders`, server-side `x-client-id` / `x-client-secret`, and `x-api-version: 2025-01-01`: https://www.cashfree.com/devstudio/preview/pg/web/checkout
- Cashfree webhook verification guide documents verifying `x-webhook-signature` against the raw request body and `x-webhook-timestamp`: https://www.cashfree.com/devstudio/preview/pg/tools/webhookVerification
These references support the current API version and signature pattern, but do not replace a real merchant sandbox test.
