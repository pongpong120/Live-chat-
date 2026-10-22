# Firebase Android migration — 2026-10-19

- Added the user-provided `google-services.json` for Firebase project `pong-pong-8187`.
- Android package/application ID set to `com.pingpong.rocket` to match the registered Firebase Android app.
- Added Google Services Gradle plugin `4.4.2` to the project and app Gradle configuration.
- Removed the debug application ID suffix so the same registered Firebase client can be matched by the Google Services plugin for debug builds.

## Web client migration
- Updated `public/firebaseClient.js` with the user-provided Web SDK configuration for project `pong-pong-8187e` (Web app ID `1:196673756478:web:a7ce6b7cf7bc153351a06f`).
- This client uses the existing Firebase compat API (`firebase.initializeApp()` / `firebase.auth()`), so ensure the app still loads the matching Firebase compat SDK scripts.
- Firebase Console provider settings, authorized domains, OAuth consent/configuration, and live sign-in must still be verified. Analytics may be configured separately; the current client file uses Authentication only.

## Build notes
A successful Firebase configuration integration is not proof that the Android app builds or that Google sign-in works. Run the Android Gradle build and test sign-in on a device. The package ID change also means this is a different Android app identity from prior builds using `com.pingpong.voice`.
