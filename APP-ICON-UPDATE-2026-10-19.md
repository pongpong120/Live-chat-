# App icon update — 2026-10-19

- Replaced `public/images/pingpong-app-icon.png` with the uploaded Play Store kit's 1024x1024 app icon.
- Added `public/manifest.webmanifest` so supported browsers can use the app icon when installed as a web app.
- Copied the provided Android launcher density assets and adaptive icon resources into `android/app/src/main/res/`.
- Set Android `android:roundIcon` to `@mipmap/ic_launcher_round`.
- Added Google Play listing assets to `play-store-assets/` (`play_store_icon_512.png`, `feature_graphic_1024x500.png`, `app_icon_1024.png`).

A new APK/AAB must be built to see the updated launcher icon on Android. The Play Store listing icon is uploaded separately in Play Console.
