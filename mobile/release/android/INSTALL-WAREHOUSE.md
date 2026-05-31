# NovaERP Warehouse (Capacitor build) — Install Guide

A native Android app for warehouse staff: picking, packing, scanning,
and bin-level cycle counting / stock correction.

**Now uses real Google ML Kit barcode scanning** (no more "this browser
doesn't support live barcode scanning" message). Camera, ML decoding,
and torch all run in native Android code via the Capacitor plugin
[`@capacitor-mlkit/barcode-scanning`](https://github.com/capawesome-team/capacitor-mlkit).

## File

`com.prakruthivanam.warehouse-Capacitor-Debug.apk`

| Field             | Value                                                |
| ----------------- | ---------------------------------------------------- |
| Package id        | `com.prakruthivanam.warehouse`                       |
| App label         | NovaERP Warehouse                                    |
| Min Android       | 5.1 (API 22)                                         |
| Target Android    | 14 (API 34)                                          |
| **Size**          | **16.3 MB** (was 3.6 MB before bundling — extra is the React bundle ~2 MB and the ML Kit native libs `libbarhopper_v3.so` + `libimage_processing_util_jni.so`) |
| Build type        | Debug (signed with Android default debug key)        |
| Permissions       | INTERNET, CAMERA, FLASHLIGHT, VIBRATE, WAKE_LOCK, ACCESS_NETWORK_STATE |

## What changed in this build

1. **Web app is now bundled inside the APK** — the React UI loads from
   `assets/public/index.html` instead of `http://217.216.78.119/m/...`.
   The app still talks to the live API at `http://217.216.78.119/v1/*`
   and pulls images from `/uploads/*`, but UI updates require an APK
   rebuild.
2. **Native barcode scanner** — `BarcodeScanner.tsx` now detects
   Capacitor at runtime and routes scans through Google ML Kit when
   running inside the APK. Web `BarcodeDetector` is still the path used
   for desktop testing. No more "browser doesn't support live barcode
   scanning" message on warehouse phones.
3. **Start URL forced to `/m/login`** — a tiny inline script in
   `index.html` does `history.replaceState({}, "", "/m/login")` before
   React Router boots, so the warehouse APK never lands on the desktop
   dashboard.

## Features

All of the existing `/m/` PWA, now installable AND with a working scanner:

- **`/m/login`** — PIN sign-in + warehouse picker
- **`/m/tasks`** — claimed pick lists & packing slips queue
- **`/m/picks/:id` + `/m/picks/:id/line/:itemId`** — scan-to-confirm picking, walk-path order, "complete" guard against stale stock, auto-reset
- **`/m/packs/:id`** — pack scan-confirm with reason codes (short pack / damage / substitute / other)
- **`/m/scan`** — barcode → routes to the right pick line / bin (now native ML Kit)
- **`/m/verify` + `/m/bin/:binId`** — bin-level cycle count = stock correction (qty before/after, reason, flagged anomaly feed)
- **`/m/loc/:code`** — location lookup
- **`/m/profile`** — sign-out / switch warehouse

## Install on a phone

1. Copy the APK to the phone (USB / Drive / WhatsApp / Bluetooth).
2. On the phone, tap the file in your file manager → **Install**.
3. Allow "install from unknown sources" for that file manager when
   Android prompts.
4. Launch **NovaERP Warehouse** from the launcher.
5. **First scan**: Android will prompt for camera permission — tap
   **Allow** once. Stays granted from then on.

If you have an older debug build of the same package id installed,
uninstall it first (the debug key may have rotated and Android will
refuse to upgrade).

## Network requirements

The bundled APK serves its UI from on-device assets, but every business
action calls the live API:

- `http://217.216.78.119/v1/*` — pick lists, packing slips, bins, etc.
- `http://217.216.78.119/uploads/*` — product images

Operators must be on a Wi-Fi (or mobile network) that can reach that
public IP.

## Rebuild

When you change web code (`erp-portal/`):

```powershell
cd D:\coding\pvsresponse\erp-portal
$env:VITE_API_URL = "http://217.216.78.119"
npm run build

# Copy the freshly-built dist into the wrapper, preserving the start-URL hack
Remove-Item ..\mobile-erp\www\* -Recurse -Force
Copy-Item dist\* ..\mobile-erp\www -Recurse -Force
# Re-add the /m/login redirect line into the bundled index.html (see
# mobile-erp/www/index.html in git for the exact snippet).

cd ..\mobile-erp
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The output APK lands at
`mobile-erp/android/app/build/outputs/apk/debug/app-debug.apk`.

When the only change is web (no plugin / native side updates), you can
even skip `cap sync` if you re-run it afterwards manually with
`npx cap copy android`.

## Production hardening (still TODO)

- [ ] Sign with a release keystore for distribution outside debug
- [ ] HTTPS on the VPS so we can drop `cleartext: true` and
      `allowMixedContent: true` from `capacitor.config.json`
- [ ] Custom app icon (currently the Capacitor default leaf)
- [ ] Add an offline retry/splash if Wi-Fi drops mid-task
- [ ] Code-split the React bundle (currently one 2 MB chunk; warning is
      benign but a code-split would save ~30% on cold launch)
