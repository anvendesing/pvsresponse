import { Navigate, Route, Routes } from "react-router-dom";
import { MfgShell } from "./MfgShell";
import { MfgLogin } from "./screens/MfgLogin";
import { MfgRoom } from "./screens/MfgRoom";
import { MfgMo } from "./screens/MfgMo";
import { MfgTransfers } from "./screens/MfgTransfers";
import { MfgProfile } from "./screens/MfgProfile";

// =====================================================================
// MfgApp — manufacturing-PWA-only route tree
// =====================================================================
// Mirrors MobileApp.tsx for the warehouse APK. Loaded by src/main.tsx
// ONLY when import.meta.env.MODE === "mfg" (Capacitor wrapper build
// from mobile-mfg/). Excludes desktop ERP and warehouse mobile so the
// manufacturing APK stays small.
//
// Also exports `mfgRoutes` so App.tsx (desktop / dev) can mount the
// same screens at /mfg/* in the full web bundle.

export const mfgRoutes = (
  <Route element={<MfgShell />}>
    <Route path="/mfg" element={<Navigate to="/mfg/room" replace />} />
    <Route path="/mfg/login" element={<MfgLogin />} />
    <Route path="/mfg/room" element={<MfgRoom />} />
    <Route path="/mfg/mo/:id" element={<MfgMo />} />
    <Route path="/mfg/transfers" element={<MfgTransfers />} />
    <Route path="/mfg/profile" element={<MfgProfile />} />
  </Route>
);

export const MfgApp = () => (
  <Routes>
    <Route element={<MfgShell />}>
      <Route path="/mfg" element={<Navigate to="/mfg/room" replace />} />
      <Route path="/mfg/login" element={<MfgLogin />} />
      <Route path="/mfg/room" element={<MfgRoom />} />
      <Route path="/mfg/mo/:id" element={<MfgMo />} />
      <Route path="/mfg/transfers" element={<MfgTransfers />} />
      <Route path="/mfg/profile" element={<MfgProfile />} />
    </Route>
    {/* Any non-/mfg/* path inside the APK lands on the mfg login. */}
    <Route path="*" element={<Navigate to="/mfg/login" replace />} />
  </Routes>
);

export default MfgApp;
