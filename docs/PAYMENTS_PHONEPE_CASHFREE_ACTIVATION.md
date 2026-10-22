# PingPong — PhonePe / Cashfree activation readiness

## Current development flow

- Recharge package truth is `payments/packages.js`.
- Fixed packages: ₹100 → 1,000,000; ₹250 → 2,600,000; ₹500 → 5,200,000; ₹1000 → 11,200,000 diamonds.
- Manual UPI uses the owner UPI ID `labib3@axl` and a server-created recharge order.
- The client never decides the final payment amount. It sends only `packageId`; the server resolves price/diamonds.
- The UPI launch link is generated server-side from the stored order and contains the server order ID (`tr`) and exact INR amount.
- Opening a UPI app or returning to PingPong is **not** payment confirmation. Diamonds are credited only after trusted server-side verification/admin approval.
- Manual QR rendering was removed from the Recharge flow.

## PhonePe PG activation

1. Complete PhonePe merchant onboarding and obtain the production credentials required by the current PhonePe PG product.
2. Set server environment variables only (never in frontend code):
   - `PAYMENTS_AUTO_ENABLED=true`
   - `PAYMENT_PROVIDER=phonepe`
   - `PUBLIC_BASE_URL=https://<your-https-domain>`
   - `PAYMENTS_SINGLE_INSTANCE_ACK=true`
   - `PHONEPE_ENABLED=true`
   - `PHONEPE_ENVIRONMENT=production`
   - `PHONEPE_CLIENT_ID=<server-secret>`
   - `PHONEPE_CLIENT_VERSION=<server-configured-version>`
   - `PHONEPE_CLIENT_SECRET=<server-secret>`
   - `PHONEPE_WEBHOOK_USERNAME=<server-configured-value>`
   - `PHONEPE_WEBHOOK_PASSWORD=<server-secret>`
3. Configure the PhonePe webhook URL to `https://<your-https-domain>/api/payments/webhook/phonepe`.
4. Configure the provider return URL through `PUBLIC_BASE_URL`; the server builds the order-specific redirect URL.
5. Run `npm run preflight` and check `/api/payments/health`.
6. Test a real sandbox transaction first, then production with a small authorized merchant test.

## Cashfree PG activation

1. Complete Cashfree merchant onboarding and obtain the production App ID / Secret Key.
2. Set: `PAYMENTS_AUTO_ENABLED=true`, `PAYMENT_PROVIDER=cashfree`, `PUBLIC_BASE_URL=https://<your-https-domain>`, `PAYMENTS_SINGLE_INSTANCE_ACK=true`, `CASHFREE_ENABLED=true`, `CASHFREE_ENVIRONMENT=production`, `CASHFREE_CLIENT_ID=<server-secret>`, `CASHFREE_CLIENT_SECRET=<server-secret>`.
3. Configure the Cashfree notify/webhook URL to `https://<your-https-domain>/api/payments/webhook/cashfree`.
4. Keep the current raw-body signature verification and server-side status lookup.
5. Test sandbox first, then production.

## Credit safety

Payment order creation, status polling, webhook handling and reconciliation are provider-independent. The server compares the provider result with its stored package amount/currency/order ID before crediting. Store event/order claims are idempotent so retries do not create duplicate diamond credits.

Do not mark a payment live until valid merchant credentials are installed and an end-to-end transaction has been verified.
