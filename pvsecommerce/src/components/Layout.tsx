// Persistent shell: announcement bar, header, nav, footer, sliding
// cart drawer, mobile drawer. The router renders pages into <Outlet>
// so navigation never tears these elements down.

import { Outlet, ScrollRestoration } from "react-router-dom";
import { useState } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { CartDrawer } from "./CartDrawer";
import { MobileDrawer } from "./MobileDrawer";

export const Layout = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <Header onOpenMobileDrawer={() => setDrawerOpen(true)} />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main style={{ minHeight: "60vh" }}>
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <ScrollRestoration />
    </>
  );
};
