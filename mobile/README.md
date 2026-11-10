# Vibelink mobile app

The Android and iPhone app. It is a shell: on first launch it asks which company's Vibelink to open
(`mycompany` opens `mycompany.vibelink.tech`; a full address such as `billing.vibelink.co.ke` also works),
remembers it, and from then on opens that site full screen. Everything inside is the web app itself, so a
deploy of the web app updates the phone app with no new store release.

- `www/` the first-launch screen and the "could not open" screen
- `capacitor.config.json` the app id (`tech.vibelink.app`) and the sites the app may open (`server.allowNavigation`)
- `android/`, `ios/` the native projects (Capacitor 8)
- `scripts/icon.mjs` draws the icon and splash; `npm run icons` regenerates every size

## Build for Android (Windows)

Needs JDK 21 and the Android SDK (`ANDROID_HOME`, here `%LOCALAPPDATA%\Android\Sdk`).

    npm install
    npm run apk       # a test APK: android/app/build/outputs/apk/debug/app-debug.apk
    npm run bundle    # the Play Store bundle: android/app/build/outputs/bundle/release/app-release.aab

Google Play only accepts a **signed** bundle. The upload key is yours and is never committed. Create it once:

    keytool -genkeypair -v -keystore android/vibelink-upload.jks -alias vibelink -keyalg RSA -keysize 2048 -validity 10000

then write `android/keystore.properties` (also never committed):

    storeFile=vibelink-upload.jks
    storePassword=...
    keyAlias=vibelink
    keyPassword=...

With that file present `npm run bundle` signs the bundle. Keep a copy of the `.jks` file and its password
somewhere safe: without them you cannot publish an update to the same app.

For each new store release raise `versionCode` (and `versionName`) in `android/app/build.gradle`.

## Build for iPhone (needs a Mac)

    npm install
    npx cap sync ios
    npx cap open ios      # opens Xcode: set the signing team, then Product > Archive

Needs Xcode and a paid Apple Developer account. The bundle id is `tech.vibelink.app`.

## What does not work inside the app

It is a web view, not Chrome, so two things the browser does are missing:

- web push notifications (the browser's "allow notifications") do not arrive
- files the page makes itself (the Winbox `.ovpn` profile, exports) may not save

Camera and location work (they are declared in the manifests).
