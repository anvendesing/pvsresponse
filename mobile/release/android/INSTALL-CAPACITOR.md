# Prakruthivanam Mobile (Capacitor build) — Install Guide

A lightweight WebView wrapper around `app.html` (the new Modern Organic
Luxury UI). Bypasses the heavy Avalonia stack entirely and is **3.6 MB**
instead of 78 MB.

## File

`com.prakruthivanam.shop-Capacitor-Debug.apk`

| Field             | Value                                |
| ----------------- | ------------------------------------ |
| Package id        | `com.prakruthivanam.shop`            |
| App label         | Prakruthivanam                       |
| Min Android       | 5.1 (API 22) — works on any phone <10 yrs old |
| Target Android    | 14 (API 34)                          |
| Size              | 3.6 MB                               |
| Build type        | Debug (signed with the Android default debug key) |

## Install on a phone

1. Copy the APK file to the phone (USB / Drive / Email / Bluetooth — any way).
2. On the phone, tap the file in your file manager.
3. Android will warn "install from unknown sources" → allow it for the file
   manager, then tap **Install**.
4. **Important:** if you have an older Avalonia build of
   `com.prakruthivanam.shop` already installed, **uninstall it first** —
   the signing keys differ, so Android will refuse to upgrade in place.

## Install on an emulator (if the user wants one later)

```powershell
adb install -r mobile\release\android\com.prakruthivanam.shop-Capacitor-Debug.apk
adb shell am start -n com.prakruthivanam.shop/.MainActivity
```

## What's inside

- `mobile-cap/www/index.html` — the existing `app.html` design verbatim
- `mobile-cap/capacitor.config.json` — wraps it as a Capacitor app
- `mobile-cap/android/` — generated Android Studio project (Gradle)

## Rebuild

```powershell
cd D:\coding\pvsresponse\mobile-cap
copy app.html www\index.html        # if you edit app.html
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The output APK lands at
`mobile-cap/android/app/build/outputs/apk/debug/app-debug.apk`.

## Pointing at the live API

The current `app.html` runs entirely client-side with mock data, so no API
calls are made. When you wire it up to the live backend, set the base URL
to **`http://217.216.78.119:8080/v1`** — the shop Nginx proxies both API
routes and `/uploads/*` images. `cleartext` HTTP is already enabled in
`capacitor.config.json`.
