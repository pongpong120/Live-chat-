# PingPong Recharge — Direct UPI App Launch Fix (2026-10-15)

## What the supplied screen recording showed

The payment-app chooser opened, but selecting an option closed the chooser and did not reliably open the selected UPI app. The previous chooser called `button.click()` after the selection. The React handler then fetched payment data asynchronously and always built a PhonePe-only Android intent, regardless of whether the user selected Google Pay or Paytm. This can lose the original user gesture in browser/WebView contexts and ignores the selected provider.

## Changes

- The chooser now extracts the currently displayed server order ID and fetches `/api/wallet/recharge/order/:orderId/payment-data` before enabling app choices.
- It validates that the response is successful and belongs to the same order before enabling the options.
- Selecting PhonePe, Google Pay, or Paytm now launches a package-specific Android `intent://` URI synchronously from the user's app-choice click.
- The UPI URI and server-generated amount/order parameters are retained; the client does not generate a new amount or payment reference.
- Any UPI App uses the standard `upi://pay` URI. If a package-specific launch cannot open an app, a generic UPI fallback is attempted.
- The app-choice handler no longer invokes a delayed synthetic click on the old React button.
- Payment remains pending until the server's existing verification/approval path confirms it. Opening an app or returning from it is not proof of payment.

## Tests performed

- `node --check server.js` — passed.
- Inline chooser script syntax check — passed.
- `node test/rechargeDirectAppLaunch.test.js` — passed (static regression assertions for package mappings, order validation, intent launch, and removal of synthetic click flow).
- `npm test` — all 74/74 suites reported passed before adding the new standalone static regression test; this new test was run separately and passed.

## Not verified on a physical device

PhonePe, Google Pay and Paytm launches were not verified on a real Android device from this environment. Android Chrome generally supports intent URIs, but a native Android WebView must permit external intent navigation in its host application's navigation handler. If this project is packaged in a custom APK whose WebView blocks external schemes, native Android `shouldOverrideUrlLoading`/intent handling is still required in that APK wrapper.

## Configuration prerequisites

- The server must be reachable from the device and the user must be authenticated.
- `/api/wallet/recharge/order/:orderId/payment-data` must return a valid server-created order ID, amount and UPI link.
- The merchant UPI ID/receiver details must be real and correctly configured. The UPI link does not itself verify payment.
- Cashfree live payment remains unavailable until genuine server-side credentials, HTTPS callback/webhook configuration, and provider verification are configured.
