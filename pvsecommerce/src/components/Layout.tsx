// Persistent shell: announcement bar, header, nav, footer, sliding
// cart drawer, mobile drawer. The router renders pages into <Outlet>
// so navigation never tears these elements down.
//
// ≥768px desktop: full Header + NavBar + Footer
// <768px phone: compact MobileHeader + CategoryChipStrip + BottomNav
// MobileDrawer is available on all viewports (hamburger on mobile,
// menu-icon on desktop header tablet breakpoint).

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
import { ScrollToTopButton } from "./ScrollToTopButton";
import { usePlatform } from "@/state/PlatformContext";
import { track } from "@/lib/activity";

export const Layout = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { isPhone } = usePlatform();
  const location = useLocation();

  // Track pageview on every route change
  useEffect(() => {
    track("pageview");
  }, [location.pathname]);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <>
      {/* PWA/offline banners */}
      <OfflineBanner />
      <SwUpdateToast />
      <PwaInstallPrompt />

      {isPhone ? (
        <>
          <MobileHeader onOpenDrawer={() => setDrawerOpen(true)} />
          <CategoryChipStrip />
        </>
      ) : (
        <Header onOpenMobileDrawer={() => setDrawerOpen(true)} />
      )}

      {/* Drawer is available on both phone and desktop */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <main className={isPhone ? "main-phone" : undefined} style={{ minHeight: "60vh" }}>
        <Outlet />
      </main>

      {isPhone ? (
        <>
          <Footer mobile />
          <BottomNav />
        </>
      ) : (
        <Footer />
      )}

      <CartDrawer />
      <ScrollToTopButton />
      <ScrollRestoration />
    </>
  );
};
