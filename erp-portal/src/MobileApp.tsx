import { Navigate, Route, Routes } from "react-router-dom";

// =====================================================================
// MobileApp — warehouse-handheld-only route tree
// =====================================================================
// This file is the entry tree for the Capacitor warehouse APK
// (com.prakruthivanam.warehouse). It deliberately imports NO desktop
// pages, NO recharts, NO Shell / CommandPalette / WorkspaceProvider —
// only the /m/* mobile screens.
//
// Loaded by src/main.tsx ONLY when import.meta.env.MODE === "mobile"
// (via a dynamic import gated by a static build-time constant), so the
// mobile production bundle never includes the desktop module graph.
//
// To add a new mobile screen: add an <import> + <Route> here, NOT in
// App.tsx.

import { MobileShell } from "./mobile/MobileShell";
import { MobileLogin } from "./mobile/screens/MobileLogin";
import { MobileTasks } from "./mobile/screens/MobileTasks";
import { MobilePick } from "./mobile/screens/MobilePick";
import { MobilePickLine } from "./mobile/screens/MobilePickLine";
import { MobilePack } from "./mobile/screens/MobilePack";
import { MobileTransfer } from "./mobile/screens/MobileTransfer";
import { MobileScan } from "./mobile/screens/MobileScan";
import { MobileVerify } from "./mobile/screens/MobileVerify";
import { MobileLocation } from "./mobile/screens/MobileLocation";
import { MobileBin } from "./mobile/screens/MobileBin";
import { MobileProfile } from "./mobile/screens/MobileProfile";
import {
  MobileGrnList,
  MobileGrnReceive,
} from "./mobile/screens/MobileGrn";
import { MobileCount } from "./mobile/screens/MobileCount";
import { MobileBulkZone } from "./mobile/screens/MobileBulkZone";
import {
  MobileReturnList,
  MobileReturnDetail,
} from "./mobile/screens/MobileReturn";

export const MobileApp = () => (
  <Routes>
    <Route element={<MobileShell />}>
      <Route path="/m" element={<Navigate to="/m/tasks" replace />} />
      <Route path="/m/login" element={<MobileLogin />} />
      <Route path="/m/tasks" element={<MobileTasks />} />
      <Route path="/m/picks/:id" element={<MobilePick />} />
      <Route
        path="/m/picks/:id/line/:itemId"
        element={<MobilePickLine />}
      />
      <Route path="/m/packs/:id" element={<MobilePack />} />
      <Route path="/m/transfers/:id" element={<MobileTransfer />} />
      <Route path="/m/scan" element={<MobileScan />} />
      <Route path="/m/verify" element={<MobileVerify />} />
      <Route path="/m/loc/:code" element={<MobileLocation />} />
      <Route path="/m/bin/:binId" element={<MobileBin />} />
      <Route path="/m/profile" element={<MobileProfile />} />
      <Route path="/m/grn" element={<MobileGrnList />} />
      <Route path="/m/grn/:poId" element={<MobileGrnReceive />} />
      <Route path="/m/count" element={<MobileCount />} />
      <Route path="/m/bulk-zone" element={<MobileBulkZone />} />
      <Route path="/m/returns" element={<MobileReturnList />} />
      <Route path="/m/returns/:id" element={<MobileReturnDetail />} />
    </Route>
    {/* Any non-/m/* path inside the APK lands on the mobile login. */}
    <Route path="*" element={<Navigate to="/m/login" replace />} />
  </Routes>
);

export default MobileApp;
