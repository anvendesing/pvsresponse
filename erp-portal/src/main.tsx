import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/globals.css";
import { BrandProvider } from "./hooks/useBrand";

// =====================================================================
// Build-mode-aware entry
// =====================================================================
// The Capacitor warehouse APK is built with `vite build --mode mobile`.
// `import.meta.env.MODE` is replaced at build time with the literal
// string "mobile" / "production", so the static comparison below is a
// constant for Rollup — the unreachable branch (and the dynamic import
// inside it) is tree-shaken out of the final bundle.
//
// Result: the warehouse APK chunk excludes App.tsx and all of its
// desktop imports (Dashboard, Inventory, Manufacturing, recharts,
// Shell, CommandPalette, WorkspaceProvider, etc.), shrinking the APK
// from ~18 MB down to roughly 6-8 MB.
//
// To debug locally: run `vite build --mode mobile` and inspect
// dist/assets — only MobileApp + its mobile/* dependencies should
// appear.

const MOBILE_BUILD = import.meta.env.MODE === "mobile";
const MFG_BUILD = import.meta.env.MODE === "mfg";

const mount = (children: React.ReactElement) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <BrandProvider>{children}</BrandProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
};

if (MOBILE_BUILD) {
  // Warehouse handheld APK: only /m/* screens. Skip the PWA install
  // prompt watcher (the APK is the install) and DO NOT statically
  // import pwa/install.ts so it's tree-shaken from the mobile bundle.
  import("./MobileApp").then(({ MobileApp }) => mount(<MobileApp />));
} else if (MFG_BUILD) {
  // Manufacturing shop-floor APK: only /mfg/* screens. Same tree-shake
  // strategy as the warehouse APK above.
  import("./manufacturing-mobile/MfgApp").then(({ MfgApp }) =>
    mount(<MfgApp />)
  );
} else {
  // Full ERP portal (web). Register the warehouse PWA shell for the
  // /m/* routes served from the browser, and watch for the install
  // prompt so the mobile UI can offer "Add to Home Screen".
  Promise.all([import("./pwa/install"), import("./App")]).then(
    ([{ registerMobilePwa, watchInstallPrompt }, { default: App }]) => {
      registerMobilePwa();
      watchInstallPrompt();
      mount(<App />);
    }
  );
}
