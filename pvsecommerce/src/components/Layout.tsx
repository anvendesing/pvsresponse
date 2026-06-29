// Persistent shell: announcement bar, header, nav, footer, sliding
// cart drawer, mobile drawer. The router renders pages into <Outlet>
// so navigation never tears these elements down.
//
// On phone viewports (≤ 720 px) the desktop header + footer are
// replaced by a compact MobileHeader + CategoryChipStrip + BottomNav.

import { Outlet, ScrollRestoration, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { CartDrawer } from "./CartDrawer";
import { MobileDrawer } from "./MobileDrawer";
import { MobileHeader } from "./mobile/MobileHeader";
import { CategoryChipStrip } from "./mobile/CategoryChipStrip";
import { BottomNav } from "./mobile/BottomNav";
import { OfflineBanner, SwUpdateToast, PwaInstallPrompt } from "./mobile/AppBanners";
import { usePlatform } from "@/state/PlatformContext";
import { track } from "@/lib/activity";

export const Layout = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { isPhone } = usePlatform();
  const location = useLocation();

  // Track pageview on every route change.
  useEffect(() => {
    track("pageview");
  }, [location.pathname]);

  return (
    <>
      {/* PWA/offline banners — always rendered, shown only when needed */}
      <OfflineBanner />
      <SwUpdateToast />
      <PwaInstallPrompt />

      {isPhone ? (
        <>
          <MobileHeader />
          <CategoryChipStrip />
        </>
      ) : (
        <>
          <Header onOpenMobileDrawer={() => setDrawerOpen(true)} />
          <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        </>
      )}

      <main className={isPhone ? "main-phone" : undefined} style={{ minHeight: "60vh" }}>
        <Outlet />
      </main>

      {isPhone ? (
        <BottomNav />
      ) : (
        <Footer />
      )}

      <CartDrawer />
      <ScrollRestoration />
    </>
  );
};
