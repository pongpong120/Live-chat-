# PingPong Play Store release checklist (updated 2026-10-19)

## Source changes in this package
- Android package ID: `com.pingpong.rocket`
- Version: `2.2.0` / versionCode `8` (confirm it is greater than the latest Play Console release)
- Account deletion page: `/account-deletion.html`
- Privacy policy: `/privacy-policy.html`
- Google Play Data safety worksheet: `docs/GOOGLE-PLAY-DATA-SAFETY-WORKSHEET.md`
- Profile setup view now has independent vertical scrolling for small screens and the on-screen keyboard.
- Profile photo crop UI supports square preview and zoom before upload.

## Before upload
1. Deploy the web app to the real HTTPS production domain. The Android WebView `WEB_APP_URL` defaults to a placeholder and MUST be overridden.
2. Publish the privacy policy and account deletion page publicly. Enter their exact production HTTPS URLs in Play Console.
3. Complete the Data safety form from the verified shipped behavior using `docs/GOOGLE-PLAY-DATA-SAFETY-WORKSHEET.md`. It is not a form submission or a substitute for the Play Console declaration.
4. Configure a real production signing key through `PINGPONG_KEYSTORE_FILE`, `PINGPONG_KEYSTORE_PASSWORD`, `PINGPONG_KEY_ALIAS`, `PINGPONG_KEY_PASSWORD`. Never upload a locally generated development-signed artifact.
5. Configure production `WEB_APP_URL`, verify `ALLOW_CLEARTEXT=false`, inspect `google-services.json` package match and Firebase production project.
6. Build the Android App Bundle with `cd android && ./gradlew clean bundleRelease`.
7. Test login, refresh persistence, account creation scroll, photo crop/upload, voice permissions, account deletion, and logout on a physical device / internal test track.
8. Verify target API requirements, Data safety, content rating, target audience, app access, store listing assets, ads declaration, billing compliance and all policy declarations in Play Console.

## Important limitation
Source edits do not prove the live backend, deployment, deletion workflow, Firebase configuration, signing key, or Play Console declarations are correct. This source archive has not been validated by a successful production AAB build or live end-to-end tests in this environment. Do not treat it as Play-Store-approved until the checks above pass.
