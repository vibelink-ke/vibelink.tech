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

## Notifications (Android)

A web view gets no web push, so the app uses Firebase Cloud Messaging. It needs a Firebase project, set up once:

1. In the Firebase console create a project and add an Android app with the package name `tech.vibelink.app`.
2. Download its `google-services.json` into `android/app/` and rebuild. Without that file the app builds and runs, with notifications off.
3. Project settings > Service accounts > Generate new private key. On each server put that key in `.env` on one line, as base64:

       echo "FCM_SERVICE_ACCOUNT=$(base64 -w0 the-key-file.json)" >> .env

   then deploy. `push.js` sends every alert that web push carries to the phones as well.

How it fits together: `res/raw/vl_shim.js` is run on every page of a Vibelink site. It asks the phone for its Firebase token
(`MainActivity`) and posts it to `/api/push/native-token` once a staff member is signed in. A tapped notification opens the page it names.

## Downloads (Android)

Files the server sends go to the Downloads folder through the system download manager, with the page's sign-in. Files the page makes
itself (exports, the Winbox `.ovpn` profile) are handed to the app by the same shim and written to Downloads.

## Not done

- iPhone: notifications and downloads above are Android only. The iOS project still needs the same two pieces (APNs for notifications).

Camera and location work (they are declared in the manifests).
