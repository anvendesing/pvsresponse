import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { TopCommandBar } from "./TopCommandBar";
import { LeftNavigation } from "./LeftNavigation";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { BottomStatusBar } from "./BottomStatusBar";
import { CommandPalette } from "./CommandPalette";
import { ScannerOverlay } from "./ScannerOverlay";
import { useHotkey } from "@/hooks/useHotkey";
import { auth } from "@/lib/api";

export const Shell = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const navigate = useNavigate();
  const sessionUser = auth.user();

  useEffect(() => {
    if (!auth.token()) {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const onSignOut = () => {
    auth.clear();
    navigate("/login", { replace: true });
  };

  useHotkey([
    {
      key: "k",
      modifiers: ["ctrl"],
      handler: () => setPaletteOpen((v) => !v),
    },
    {
      key: "/",
      modifiers: ["ctrl"],
      handler: () => setPaletteOpen(true),
    },
    {
      key: "b",
      modifiers: ["ctrl"],
      handler: () => setScannerOpen(true),
    },
    {
      key: "Escape",
      handler: () => {
        setPaletteOpen(false);
        setScannerOpen(false);
      },
      preventDefault: false,
    },
  ]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-canvas">
      <TopCommandBar
        onToggleSidebar={() => setCollapsed((v) => !v)}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenScanner={() => setScannerOpen(true)}
        onSignOut={onSignOut}
        warehouse="WH-MAIN"
        shift="A"
        user={{
          name: sessionUser?.name ?? "Signed in",
          role: sessionUser?.role ?? "",
          username: sessionUser?.username,
        }}
        notifications={4}
      />
      <div className="flex flex-1 min-h-0">
        <LeftNavigation collapsed={collapsed} />
        <div className="flex-1 flex flex-col min-w-0">
          <WorkspaceTabs onNewTab={() => navigate("/dashboard")} />
          <main className="flex-1 min-h-0 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <BottomStatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ScannerOverlay open={scannerOpen} onClose={() => setScannerOpen(false)} />
    </div>
  );
};
