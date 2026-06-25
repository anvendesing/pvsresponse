# Prakruthivanam Manufacturing (Capacitor build)

Shop-floor Android app for production-room operators.
Wraps the `/mfg/*` PWA inside a Capacitor WebView so it installs and runs
like a native app on the factory tablet.

## What's inside

* App ID: `com.prakruthivanam.manufacturing`
* Display name: **Prakruthivanam Manufacturing**
* Routes: `/mfg/login`, `/mfg/room`, `/mfg/mo/:id`, `/mfg/transfers`, `/mfg/profile`
* Features: machine-run logging (multiple machines in parallel per WO),
  material release / issue, transfer-in tracking, MO completion.
* Bundle size: ~250 KB JS + ~65 KB CSS (slim `--mode mfg` Vite build,
  no desktop or warehouse modules).

## Install (sideload)

1. On the tablet, enable **Settings → Apps → Special access → Install
   unknown apps** for your file manager / browser.
2. Transfer `Prakruthivanam-Manufacturing-vX.Y.Z.apk` to the device
   (USB, Drive, email).
3. Open it from a file manager and tap **Install**.
4. Launch **Prakruthivanam Manufacturing**.

Side-by-side install with the **Prakruthivanam Warehouse** APK is
supported — they use different package IDs
(`com.prakruthivanam.manufacturing` vs `com.prakruthivanam.warehouse`).

## First-run setup

1. Tap **Configure server** (or open `Profile`) and point the app at the
   backend URL (e.g. `https://erp.your-domain.com/v1`).
2. Log in with your operator PIN.
3. Pick the production room (facility). The device is then pinned to
   that facility until you reset it from `Profile`.

## Rebuild from source

```powershell
cd erp-portal
npm run build:mfg          # vite build --mode mfg + sync to mobile-mfg/www

cd ..\mobile-mfg
npm run build:android      # cap sync + gradle assembleDebug

# APK lands at:
#   mobile-mfg\android\app\build\outputs\apk\debug\app-debug.apk
# Copy + rename to mobile\release\android\Prakruthivanam-Manufacturing-vX.Y.Z.apk
```

Bump `versionCode` and `versionName` in
`mobile-mfg/android/app/build.gradle` before each release.

## Troubleshooting

* **Stuck on a stale bundle?** Visit `/mfg/?reset=1` in a browser tab on
  the device to wipe SW caches (only useful for browser PWA install —
  the Capacitor APK reloads on every cold start).
* **MainActivity package error?** The Java file must be in
  `android/app/src/main/java/com/prakruthivanam/manufacturing/MainActivity.java`
  with namespace and applicationId both set to
  `com.prakruthivanam.manufacturing`.
