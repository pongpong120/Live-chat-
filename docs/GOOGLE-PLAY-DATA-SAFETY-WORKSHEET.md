# Google Play Data safety — publisher completion worksheet

**Package:** `com.pingpong.rocket`  
**Source version:** 2.2.0 (versionCode 8)  
**Status:** Preparation worksheet — NOT a completed Play Console declaration.

Google Play's Data safety form is completed inside Play Console; a local file cannot submit it. The publisher must verify each answer against the exact production build, enabled SDKs, backend, analytics, payments, storage and retention practices. Do not copy answers blindly.

## Data types to investigate and declare when applicable

| Category | Potential data in this project | Publisher verification |
|---|---|---|
| Personal info | Phone/mobile number, username, profile details, country/language, profile photo | Confirm fields actually collected and whether optional |
| Messages | Chat/messages, support communications, user reports | Confirm retention, moderation and deletion behavior |
| Photos and videos | Profile photo; camera/gallery use where user initiates it | Confirm uploads and storage provider |
| Audio | Voice-room audio / microphone use | Confirm whether audio is transmitted live, recorded, or stored; do not claim “not collected” without checking |
| App activity | Room participation, gifts, user interactions and service activity | Confirm backend logs and analytics SDKs |
| Device or other IDs | Firebase installation/device identifiers or other SDK identifiers, if enabled | Inspect dependencies, manifests, runtime configuration and network traffic |
| Financial info / purchases | Recharge, virtual currency, orders and transaction records | Confirm whether payment data is handled by the app, a processor, or both |
| App info and performance | Crash, diagnostics, logs, network/security signals | Confirm whether any SDK collects these |
| Location | No declaration should be inferred from permissions alone; inspect actual SDK behavior | Confirm all SDKs and permissions |

## Questions that must be answered in Play Console

For every applicable data type:
- Is it collected, shared, or both?
- Is collection required or optional?
- Is it processed ephemerally?
- What purposes apply (app functionality, account management, security/fraud prevention, analytics, developer communications, etc.)?
- Is data encrypted in transit?
- Can users request deletion?
- Does the app meet the applicable account deletion requirements?

## Account deletion URLs

- In-app deletion: Profile/Settings → Delete account; backend route `DELETE /api/account`.
- Public web request page: `https://YOUR-PRODUCTION-DOMAIN/account-deletion.html` (replace with the real deployed domain before submission).
- Privacy policy: `https://YOUR-PRODUCTION-DOMAIN/privacy-policy.html` (replace with the real deployed domain before submission).
- Support email currently referenced by the app: `pingpongappsupport@gmail.com`.

## Release blockers — verify before declaring ready

1. Replace the placeholder domain in Play Console with the real public HTTPS URLs.
2. Open both pages in a logged-out browser and confirm they return HTTP 200 without authentication.
3. Submit a deletion request from a test account and verify that backend records, profile photo/object storage, authentication identity and any linked records are handled correctly.
4. Verify what happens to financial, anti-fraud, audit and legally retained records, and document retention periods.
5. Inspect Firebase, Agora/voice, hosting, object storage, analytics, crash reporting, payment and advertising SDK configuration actually shipped.
6. Complete the Data safety form from verified behavior, then compare it with the privacy policy.
7. Complete Play Console App access, content rating, target audience, ads, permissions, store listing and testing requirements.

**Do not publish this worksheet as if it were an official completed declaration.** The publisher is responsible for the accuracy of the final Play Console answers.
