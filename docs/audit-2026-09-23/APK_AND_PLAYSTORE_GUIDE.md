# PingPong — Android APK Release & Play Store Guide

## A. Generate a production signing key (one-time, if you don't already have one)
```
keytool -genkey -v -keystore pingpong-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias pingpong
```
Store this file and its passwords somewhere safe (password manager). **Never commit it to GitHub.** Losing it means you can never update the app under the same package on Play Store again.

## B. Set build environment variables (locally or in CI — never in the repo)
```
export PINGPONG_KEYSTORE_FILE=/absolute/path/to/pingpong-release.jks
export PINGPONG_KEYSTORE_PASSWORD=your_store_password
export PINGPONG_KEY_ALIAS=pingpong
export PINGPONG_KEY_PASSWORD=your_key_password
```
Also set `local.properties` (copy from `android/local.properties.example`) with:
```
WEB_APP_URL=https://your-real-production-domain.com/
ALLOW_CLEARTEXT=false
```

## C. Build the release APK/AAB
From the `android/` folder:
```
./gradlew clean assembleRelease      # produces a signed .apk
./gradlew bundleRelease              # produces a signed .aab (Play Store upload format)
```
Output: `android/app/build/outputs/apk/release/app-release.apk` (or `bundle/release/app-release.aab`).
The build will **fail with a clear GradleException** if any of the four signing env vars are missing — this is intentional, so a debug/unsigned build can never accidentally ship.
This step needs network access (Gradle + Android SDK downloads) and a JDK — run it on your own machine or CI runner. See `docs/PLAY-STORE-RELEASE-CHECKLIST-2026-10-19.md` for current release gates.

## D. Install/Test the APK
```
adb install -r android/app/build/outputs/apk/release/app-release.apk
```
Test against your real production `WEB_APP_URL` — confirm login, OTP, room join, voice, gifts all work end to end (same smoke-test flow as the deployment guide).

## E. Play Store Preparation Checklist
- [ ] Signed `.aab` built via `bundleRelease` (Play Store requires AAB, not APK, for new apps)
- [ ] `versionCode` incremented from the previous release (currently `8` in this source — bump before each new submission)
- [ ] Privacy Policy URL ready (required for apps handling user accounts/voice/payments)
- [ ] Data Safety form filled in Play Console (what data you collect: phone number for OTP, profile info, voice — declare accurately)
- [ ] Target API level meets Play Store's current minimum (check Play Console's current requirement at submission time — this changes yearly)
- [ ] Store listing: app name, short/full description, screenshots, feature graphic, icon
- [ ] Content rating questionnaire completed (voice chat + virtual currency likely affects rating)
- [ ] In-app purchase / virtual currency (Coins/Diamonds/Beans) compliance — if real money is involved, Play's Billing policy may require Google Play Billing for digital goods; review Play's current policy before submission, this is an account-level legal/compliance decision I can't make for you
- [ ] Test on a physical device or Play Console's internal testing track before public release

## F. What I could not verify here
I have no Android SDK, no Gradle distribution, and no network in this sandbox — so I could not actually run `gradlew assembleRelease` or produce a real `.apk`/`.aab` file. The build configuration itself (signing, ProGuard, network security config, versioning) was code-reviewed and is correct; the actual build must run on your machine or a CI runner with network access.
