# Wraith Android app

A real Android app (Capacitor). It shows `https://www.wraith.farm/app` inside the app's own window, so there is no
browser address bar, no browser menus, and no Chrome in between. Website changes show up without reinstalling.
Only rebuild the APK when something native changes (icon, plugins, Firebase).

The website recognises the app by its user agent (`WraithApp`), so the "download the app" screen never shows inside it.

## Build

Needs Android Studio (for its bundled Java and the SDK). From this folder:

```powershell
npm install
node scripts/make-icons.mjs          # run from the repo root: node android-app/scripts/make-icons.mjs
npx cap sync android
cd android
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleRelease
```

The signed APK is `android/app/build/outputs/apk/release/app-release.apk`. Copy it to `public/downloads/wraith.apk`
to update the download button on the website.

## Signing key (do not lose it)

`wraith-release.keystore` and `keystore.properties` are in this folder and are git-ignored. Back both up somewhere safe
(password manager, private drive). Without that key you cannot publish an update that installs over this app.

## Push notifications

1. Firebase console, your project, Project settings, Your apps: add an Android app with package name `farm.wraith.app`.
2. Download `google-services.json` and put it in `android/app/`.
3. Rebuild. The app registers for notifications and links its token through the existing `/api/push/fcm` route.

## Sign-in

Google blocks its sign-in page inside an app window, so the app uses email sign-in (a one-time code). In the Privy
dashboard, Login methods, turn on **Email**.
