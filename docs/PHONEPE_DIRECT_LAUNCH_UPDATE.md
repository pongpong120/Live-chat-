# PhonePe Direct Launch Update — 2026-10-15

## What changed
- Recharge buttons continue to request payment data from the authenticated server order endpoint.
- On Android, the PhonePe method now launches an Android `intent://` URL pinned to package `com.phonepe.app`, using the query string from the server-generated UPI link. The client does not calculate or change amount, payee, or transaction reference.
- Other UPI methods retain their existing provider links.
- If the server does not return a payment link, the UI shows a recoverable error rather than pretending the app opened.

## Important limitation
This is a direct app-launch improvement for the existing manual UPI flow. It is not a live PhonePe Payment Gateway integration. Manual UPI payments remain pending until the existing trusted review/approval process confirms the payment. Do not enable automatic diamond credit from a client return or deep-link callback.

## Future live gateway activation
Use the official PhonePe/Cashfree merchant onboarding and provider credentials. Configure server-only environment variables documented in `docs/PAYMENTS_PHONEPE_CASHFREE_ACTIVATION.md`; keep `PAYMENTS_AUTO_ENABLED` off until credentials, provider callbacks/webhooks, signature verification, payment-status verification, and idempotent crediting have been validated in the provider's sandbox. Do not put secrets in frontend assets.
