import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/shell/Shell";
import { WorkspaceProvider } from "./hooks/useWorkspace";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Products } from "./pages/Products";
import { Inventory } from "./pages/Inventory";
import { Warehouse } from "./pages/Warehouse";
import { Transfers } from "./pages/Transfers";
import { Manufacturing } from "./pages/Manufacturing";
import { ProductionLog } from "./pages/ProductionLog";
import { Boms } from "./pages/Boms";
import { Procurement } from "./pages/Procurement";
import { Productivity } from "./pages/Productivity";
import { Billing } from "./pages/Billing";
import { Customers } from "./pages/Customers";
import { Enquiries } from "./pages/Enquiries";
import { Quotes } from "./pages/Quotes";
import { SalesOrders } from "./pages/SalesOrders";
import { Picking } from "./pages/Picking";
import { Packing } from "./pages/Packing";
import { Returns } from "./pages/Returns";
import { RequireRole } from "./components/common/RequireRole";
import { PriceLists } from "./pages/PriceLists";
import { Transport } from "./pages/Transport";
import { Reports } from "./pages/Reports";
import { ContainerReports } from "./pages/ContainerReports";
import { WarehouseAudit } from "./pages/WarehouseAudit";
import { Approvals } from "./pages/Approvals";
import { Settings } from "./pages/Settings";
import { PutawayRules } from "./pages/PutawayRules";
import { PublicQuote } from "./pages/PublicQuote";
import { PublicInvoice } from "./pages/PublicInvoice";
import { PublicSalesOrder } from "./pages/PublicSalesOrder";
import { PublicPackingSlip } from "./pages/PublicPackingSlip";
import { PublicPurchaseOrder } from "./pages/PublicPurchaseOrder";
import { PrintPickList } from "./pages/PrintPickList";
import { PrintPackingSlip } from "./pages/PrintPackingSlip";
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
import { MobileGrnList, MobileGrnReceive } from "./mobile/screens/MobileGrn";
import {
  MobileGrnQcDetail,
  MobileGrnQcList,
} from "./mobile/components/GrnMobileHelpers";
import { MobileCount } from "./mobile/screens/MobileCount";
import { MobileBulkZone } from "./mobile/screens/MobileBulkZone";
import { MobileBulkCapture } from "./mobile/screens/MobileBulkCapture";
import { MobileReturnList, MobileReturnDetail } from "./mobile/screens/MobileReturn";
import { mfgRoutes } from "./manufacturing-mobile/MfgApp";
import { Store } from "./pages/Store";

const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Public-facing storefront mock. Outside the auth wrapper so a
          visitor can place a prepaid test order without a NovaERP login. */}
      <Route path="/store" element={<Store />} />
      {/* Public share viewers - intentionally OUTSIDE the auth wrapper so
          customers can open them without a NovaERP login. */}
      <Route path="/share/quote/:token" element={<PublicQuote />} />
      <Route path="/share/invoice/:token" element={<PublicInvoice />} />
      <Route path="/share/sales-order/:token" element={<PublicSalesOrder />} />
      <Route path="/share/packing-slip/:token" element={<PublicPackingSlip />} />
      <Route
        path="/share/purchase-order/:token"
        element={<PublicPurchaseOrder />}
      />
      {/* Authenticated paper / PDF views. Outside the Shell so the page
          is chrome-free for print, but uses the operator's existing
          token (api fetcher attaches it from localStorage). */}
      <Route path="/print/pick-list/:id" element={<PrintPickList />} />
      <Route path="/print/packing-slip/:id" element={<PrintPackingSlip />} />
      {/* Warehouse mobile PWA - completely separate shell, lives under /m. */}
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
        {/* GRN / receiving */}
        <Route path="/m/grn" element={<MobileGrnList />} />
        <Route path="/m/grn/:poId" element={<MobileGrnReceive />} />
        <Route path="/m/grn-qc" element={<MobileGrnQcList />} />
        <Route path="/m/grn-qc/:grnId" element={<MobileGrnQcDetail />} />
        {/* Bin cycle count / stock adjustment */}
        <Route path="/m/count" element={<MobileCount />} />
        <Route path="/m/bulk-zone" element={<MobileBulkZone />} />
        <Route path="/m/bulk-capture" element={<MobileBulkCapture />} />
        {/* Returns processing */}
        <Route path="/m/returns" element={<MobileReturnList />} />
        <Route path="/m/returns/:id" element={<MobileReturnDetail />} />
      </Route>
      {/* Manufacturing room PWA - separate shell pinned to a ProductionFacility. */}
      {mfgRoutes}
      <Route
        element={
          <WorkspaceProvider>
            <Shell />
          </WorkspaceProvider>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/products"       element={<RequireRole roles={["supervisor","procurement"]}><Products /></RequireRole>} />
        <Route path="/procurement"    element={<RequireRole roles={["procurement"]}><Procurement /></RequireRole>} />
        <Route path="/price-lists"    element={<RequireRole roles={["procurement"]}><PriceLists /></RequireRole>} />

        <Route path="/customers"      element={<RequireRole roles={["supervisor","billing"]}><Customers /></RequireRole>} />
        <Route path="/enquiries"      element={<RequireRole roles={["supervisor","billing"]}><Enquiries /></RequireRole>} />
        <Route path="/quotes"         element={<RequireRole roles={["supervisor","billing"]}><Quotes /></RequireRole>} />
        <Route path="/sales-orders"   element={<RequireRole roles={["supervisor","billing"]}><SalesOrders /></RequireRole>} />

        <Route path="/picking"        element={<RequireRole roles={["supervisor","warehouse","billing"]}><Picking /></RequireRole>} />
        <Route path="/packing"        element={<RequireRole roles={["supervisor","warehouse","billing"]}><Packing /></RequireRole>} />
        <Route path="/returns"        element={<RequireRole roles={["supervisor","billing","warehouse"]}><Returns /></RequireRole>} />

        <Route path="/inventory"      element={<RequireRole roles={["supervisor","warehouse","procurement"]}><Inventory /></RequireRole>} />
        <Route path="/warehouse"      element={<RequireRole roles={["supervisor","warehouse"]}><Warehouse /></RequireRole>} />
        <Route path="/transfers"      element={<RequireRole roles={["supervisor","warehouse"]}><Transfers /></RequireRole>} />
        <Route path="/putaway-rules"  element={<RequireRole roles={["admin"]}><PutawayRules /></RequireRole>} />
        <Route path="/warehouse-audit" element={<RequireRole roles={["warehouse"]}><WarehouseAudit /></RequireRole>} />

        <Route path="/manufacturing"  element={<RequireRole roles={["supervisor"]}><Manufacturing /></RequireRole>} />
        <Route path="/manufacturing/log" element={<RequireRole roles={["supervisor"]}><ProductionLog /></RequireRole>} />
        <Route path="/manufacturing/boms/new" element={<RequireRole roles={["supervisor"]}><Boms /></RequireRole>} />
        <Route path="/manufacturing/boms/:bomId" element={<RequireRole roles={["supervisor"]}><Boms /></RequireRole>} />
        <Route path="/manufacturing/boms" element={<RequireRole roles={["supervisor"]}><Boms /></RequireRole>} />
        <Route path="/productivity"   element={<RequireRole roles={["supervisor"]}><Productivity /></RequireRole>} />
        <Route path="/transport"      element={<RequireRole roles={["supervisor","warehouse"]}><Transport /></RequireRole>} />

        <Route path="/billing"        element={<RequireRole roles={["billing"]}><Billing /></RequireRole>} />
        <Route path="/reports"        element={<RequireRole roles={["supervisor","billing","procurement"]}><Reports /></RequireRole>} />
        <Route path="/reports/containers" element={<RequireRole roles={["supervisor","billing","warehouse"]}><ContainerReports /></RequireRole>} />
        <Route path="/approvals"      element={<RequireRole roles={["supervisor","billing"]}><Approvals /></RequireRole>} />
        <Route path="/settings"       element={<RequireRole roles={["admin"]}><Settings /></RequireRole>} />
      </Route>
    </Routes>
  );
};

export default App;
