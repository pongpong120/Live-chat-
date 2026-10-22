# Payment UI hardening — 2026-10-17

## Changes
- Disabled configuration now reports `mode: disabled`, not `manual`.
- The recharge UI no longer falls back to creating a manual UPI order when gateway checkout is not configured.
- Removed the hard-coded owner UPI ID from the payment page; it must not be presented as a verified merchant checkout.
- Removed the internal developer note accidentally shown below the package cards.
- The default-off regression test now asserts that payment mode is disabled.

## Live activation requirements
A real gateway still requires approved merchant credentials, correct server-only environment variables, a public HTTPS URL, provider dashboard return/webhook configuration, a production database and a verified sandbox-to-production transaction. Adding secrets alone cannot guarantee success if merchant onboarding, callback URLs, network access, API versions, or provider account permissions are incorrect.

## Validation
`node --check payments/paymentService.js` and `node --check payments/index.js` passed. `node --test test/paymentsGateway.test.js` is run after this change; it tests service logic with mocked providers, not live merchant credentials or real payment settlement.
