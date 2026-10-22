# PingPong Recharge UI and Gateway Setup — 2026-10-15

## UI bug fixed
The wallet UI loaded the selected recharge package using `priceINR` but did not set the `price` property used by the selected-package state and checkout button. That left the displayed total as `NaN` / `₹0.00` and could block order creation. The mapping now explicitly normalizes `price` from `priceINR` and numeric diamond/bonus fields. Display and click guards also reject invalid prices instead of rendering `NaN`.

## Trusted fixed packages
- ₹100 = 1,000,000 diamonds
- ₹250 = 2,600,000 diamonds
- ₹500 = 5,200,000 diamonds
- ₹1,000 = 11,200,000 diamonds

## Gateway activation (server environment only)
Never put API secrets in browser JavaScript, app assets, or this ZIP. Configure the selected provider on the server and restart it. For PhonePe:
- `PAYMENTS_AUTO_ENABLED=true`
- `PAYMENT_PROVIDER=phonepe`
- `PAYMENTS_SINGLE_INSTANCE_ACK=true` only if the wallet deployment really is single-instance and the operator accepts that limitation
- `PUBLIC_BASE_URL=https://YOUR_PUBLIC_DOMAIN`
- `PHONEPE_ENABLED=true`
- `PHONEPE_ENVIRONMENT=sandbox` until sandbox testing is complete; use `production` only with approved live credentials
- Set `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_VERSION`, `PHONEPE_CLIENT_SECRET`, `PHONEPE_WEBHOOK_USERNAME`, and `PHONEPE_WEBHOOK_PASSWORD` from the PhonePe merchant dashboard.

For Cashfree, set `PAYMENT_PROVIDER=cashfree`, `CASHFREE_ENABLED=true`, `CASHFREE_ENVIRONMENT=sandbox`, `CASHFREE_CLIENT_ID`, and `CASHFREE_CLIENT_SECRET` using the merchant dashboard. Ensure the HTTPS domain is allow-listed at Cashfree.

Production auto-payments require `DATABASE_URL` / PostgreSQL and the migrations for durable, unique payment records. Do not rely on in-memory payment storage in production. Configure provider callback/webhook URLs for `/api/payments/webhook/phonepe` or `/api/payments/webhook/cashfree` as required by the provider dashboard. Test successful, failed, cancelled, delayed, and duplicate callbacks before real money is accepted.

## Current status and limitations
- Automated payment integration tests: 76 passed, 0 failed in the local test suite.
- These are mocked/offline tests; no live PhonePe or Cashfree credentials were used, and no real payment was performed.
- Actual API credentials, merchant account approval, public HTTPS URL, provider dashboard callbacks, and production database configuration must be supplied by the project owner. The ZIP cannot safely manufacture these credentials.
- If the app is distributed through Google Play, check the current Play payments policy for virtual currency before enabling external payment checkout in the Play-distributed app.
