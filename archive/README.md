# Archive

This folder contains retired projects that are no longer actively maintained.

## `NovaErp/` — Avalonia ERP (retired)

An Avalonia 11.3 cross-platform ERP that targeted Windows desktop, Android,
iOS, and the browser. It was built as a prototype for warehouse and
manufacturing station workflows.

**Why retired:** The warehouse mobile workflow has been consolidated onto the
React PWA (`erp-portal/src/mobile/`) packaged as a Capacitor Android APK
(`mobile-erp/`). This gives a single codebase for both the admin web portal
and the warehouse handheld app, with no .NET toolchain dependency.

**Kept for:** historical reference and as a source of UI/UX ideas. The design
tokens, screen layouts, and sync-engine concepts influenced the current
Capacitor implementation.
