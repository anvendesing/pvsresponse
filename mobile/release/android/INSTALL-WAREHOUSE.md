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

## What changed in v1.2.0

1. **Multi-container packing** — `/m/packs/:id` supports cartons/bags/boxes: add containers, allocate confirmed lines, seal with weight, then mark packed.
2. **Compact bin scan codes** — Soap Room labels (`WSP.AS05.11`) resolve in Scan, Pick, and Pack flows.
3. **Variant-aware bin detail** — `/m/bin/:binId` shows variant stock, search-to-reassign product/variant.
4. **Transfer tasks** — `/m/tasks` Transfer tab for replenishment / putaway orders.
5. **GRN + Returns** — under Tasks → More: `/m/grn`, `/m/returns`.
6. **Slim mobile bundle** — warehouse-only `MobileApp` tree (~130 KB JS) synced via `npm run build:mobile`.

## What changed in v1.1.0

1. **Web app is now bundled inside the APK** — the React UI loads from
   on-device assets instead of loading from the VPS URL.
   The app still talks to the live API at `http://217.216.78.119/v1/*`
   and pulls images from `/uploads/*`, but UI updates require an APK
   rebuild.
2. **Native barcode scanner** — Google ML Kit via Capacitor (not browser BarcodeDetector).
3. **Start URL** — non-`/m/*` paths redirect to `/m/login` via `MobileApp.tsx`.

## Features

All `/m/` PWA screens, installable with native ML Kit scanning:

- **`/m/login`** — PIN sign-in + warehouse picker
- **`/m/tasks`** — Pick / Pack / Transfer queues + More (GRN, Returns, Count)
- **`/m/picks/:id` + line** — scan-to-confirm picking, walk-path, stale-stock guard
- **`/m/packs/:id`** — legacy single-bundle OR multi-container packing with seal/weight
- **`/m/transfers/:id`** — execute transfer / putaway
- **`/m/scan`** — bin (`WSP.*`) or product barcode → location / bin detail
- **`/m/verify` + `/m/bin/:binId`** — cycle count / stock correction, variant reassign
- **`/m/loc/:code`** — location lookup
- **`/m/grn` + `/m/grn/:poId`** — mobile GRN receive (role-gated)
- **`/m/returns` + detail** — customer return decide/finalize
- **`/m/count`** — cycle count list
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

When you change warehouse mobile code (`erp-portal/src/mobile/` or shared libs):

```powershell
cd D:\coding\pvsresponse\erp-portal
cp .env.mobile.example .env.mobile   # set VITE_API_URL if needed
npm run build:mobile                 # builds + syncs to mobile-erp/www/

cd ..\mobile-erp
npm run build:android                # sync + assembleDebug APK
```

Output: `mobile-erp/android/app/build/outputs/apk/debug/app-debug.apk` (~8 MB).

**Browser PWA** (no APK): open `http://217.216.78.119/m/tasks` on the phone — same screens, uses the VPS-hosted bundle (updates on each deploy).

## Production hardening (still TODO)

- [ ] Sign with a release keystore for distribution outside debug
- [ ] HTTPS on the VPS so we can drop `cleartext: true` and
      `allowMixedContent: true` from `capacitor.config.json`
- [ ] Custom app icon (currently the Capacitor default leaf)
- [ ] Add an offline retry/splash if Wi-Fi drops mid-task
- [ ] Code-split the React bundle (currently one 2 MB chunk; warning is
      benign but a code-split would save ~30% on cold launch)
