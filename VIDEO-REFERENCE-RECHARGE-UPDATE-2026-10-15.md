# PingPong Recharge UI update — 2026-10-15

## Included
- Updated the wallet's UPI chooser to follow the supplied video flow: yellow Maza-style header, server-issued amount and order ID, selectable PhonePe / Paytm / Google Pay / Other UPI rows, and a separate Pay button.
- Payment app selection does not create or alter an order. It launches only the server-issued UPI payment link for the already-created order.
- The UI displays the amount returned by the server's payment-data endpoint. The server-issued order ID is validated before enabling Pay.
- The wallet still treats returning from a UPI app as **not** proof of payment. Diamond crediting must follow existing server-side verification / admin approval.
- No package prices, wallet balances, app features, or provider secrets were changed.

## Configuration and production limitations
- Automatic PhonePe / Cashfree gateway payments remain disabled unless the required server environment variables are configured.
- Production auto-crediting requires HTTPS, verified provider webhooks, a configured PostgreSQL database, and the payment deployment requirements documented in `docs/PAYMENTS_GATEWAY.md`.
- The UI update does not prove a real-money payment; test sandbox and production credentials separately before launch.

## Verification
- `node --check` passed for the updated standalone UPI chooser script.
- `npm test`: 75/75 test suites passed on 2026-10-15 in the local test environment.
- Live UPI app launches, provider callbacks, and real-money crediting were not exercised by the local test run.
