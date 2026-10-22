# Production release gate — Google Play policy guide

This checklist is based on `Google_Play_Policy_Guide_PingPong_English.pdf`. It is a release checklist, not legal advice or a guarantee of Play approval.

## Must be verified before Play release

- [ ] Store listing, screenshots, permissions, and actual app behavior accurately match.
- [ ] Publish the privacy policy at a publicly accessible normal web page, link it inside the app and in Play Console, and ensure its data practices match the Data safety form and every SDK.
- [ ] Verify the in-app account deletion flow (`DELETE /api/account`) on a real test account, including all associated user data and disclosed legal/security retention.
- [ ] Publish a working external account-deletion request web page and enter its URL in Play Console. A local HTML file or a mailto link alone is not proof of a live, functioning deletion workflow.
- [ ] Complete the Data safety form from the deployed build and actual third-party SDK behavior.
- [ ] Explain microphone use before requesting permission where required; verify secure HTTPS/TLS transport for all production endpoints.
- [ ] For digital goods/virtual Diamonds sold in a Play-distributed app, use Google Play Billing unless the app and transaction are covered by an applicable enrolled exception/program. Do not enable PhonePe, Cashfree, UPI or external checkout for in-app digital goods until policy eligibility is confirmed.
- [ ] Implement and test UGC reporting/blocking, moderation, complaint handling, and applicable child-safety requirements for the real release audience.
- [ ] Review any betting, cash-out, or real-world-prize mechanics separately for gambling, financial and local-law requirements.
- [ ] Complete the device/network test matrix and clear all Play Console warnings.

## Payment integration safety

- Automatic PhonePe/Cashfree gateway mode defaults to OFF. Keep `PAYMENTS_AUTO_ENABLED=false` for the Play release unless policy eligibility and the applicable billing program have been confirmed.
- The current gateway wallet adapter writes to JSON-backed user balances. It is a single-instance limitation and is not a horizontally scalable transactional wallet ledger.
- Sandbox and production credentials, merchant account approval, provider dashboard webhook configuration, HTTPS redirect URLs, and end-to-end real transaction verification are deployment tasks. They cannot be proven by static source inspection.
- Never package real service-account keys, payment secrets, admin passwords, or production tokens in this ZIP or an APK.

## Validation status for this source archive

- JavaScript syntax preflight: verified in the build workspace after the preflight script was updated to run concurrent checks with progress output.
- Full automated test suite: not verified in this workspace because dependency installation could not be completed within the execution window.
- Live provider transactions, production database/Redis, Android device tests, Play Console declarations, policy eligibility and deployed URLs: not verified.
- Therefore this archive is a **hardened candidate for staging validation**, not a claim of fully production-ready or Play-approved software.
