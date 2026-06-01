import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { auth } from "../lib/api";
import {
  installApp,
  isStandalone,
  onInstallReadyChange,
} from "../pwa/install";
import { useDeviceWarehouse } from "./useDeviceWarehouse";

// =====================================================================
// MobileShell
// =====================================================================
// The /m PWA is a *separate* shell from the desktop one - it's a
// single full-bleed column with a sticky bottom-tab nav. We deliberately
// do NOT reuse Shell.tsx because:
//   - desktop Shell carries a workspace/tab bar that doesn't make sense
//     on a 5" screen,
//   - the mobile shell needs portrait-only padding-safe layout for
//     standalone install on iOS / Android.
//
// Auth gate: anything under /m/* requires a token. /m/login is the only
// public route. We keep the UX dead-simple - lose the token, go back
// to PIN.

const tabs = [
  { to: "/m/tasks", label: "Tasks", icon: ListIcon },
  { to: "/m/scan", label: "Scan", icon: ScanIcon },
  { to: "/m/count", label: "Count", icon: CountIcon },
  { to: "/m/verify", label: "Verify", icon: VerifyIcon },
  { to: "/m/profile", label: "Profile", icon: UserIcon },
] as const;

export const MobileShell = () => {
  const location = useLocation();
  const nav = useNavigate();
  const wh = useDeviceWarehouse();
  const user = auth.user();
  const [installReady, setInstallReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    return onInstallReadyChange(setInstallReady);
  }, []);

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  const onLoginRoute = location.pathname === "/m/login";

  // Auth gate: kick the user back to /m/login if no token.
  useEffect(() => {
    if (!auth.token() && !onLoginRoute) {
      nav("/m/login", { replace: true });
    }
  }, [location.pathname, onLoginRoute, nav]);

  // Pick a warehouse before showing tabs. On first install the user is
  // sent to the warehouse picker as part of /m/login.
  useEffect(() => {
    if (auth.token() && !wh && !onLoginRoute) {
      nav("/m/login", { replace: true });
    }
  }, [wh, onLoginRoute, nav]);

  const installVisible = installReady && !isStandalone();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900">
      {/* Top bar */}
      {!onLoginRoute && (
        <header className="sticky top-0 z-30 flex items-center justify-between bg-[#003087] px-4 py-3 text-white shadow-sm pt-[max(env(safe-area-inset-top),0.75rem)]">
          <div className="flex flex-col leading-tight">
            <span className="text-xs uppercase tracking-wider opacity-80">
              {wh?.code ?? "no warehouse"}
            </span>
            <span className="text-base font-semibold">
              {greet()} {user?.name?.split(" ")[0] ?? "Worker"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!online && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase">
                offline
              </span>
            )}
            {installVisible && (
              <button
                type="button"
                className="rounded-full border border-white/40 bg-white/10 px-3 py-1 text-xs font-medium"
                onClick={() => installApp()}
              >
                Install
              </button>
            )}
          </div>
        </header>
      )}

      {/* Page area */}
      <main
        className={
          onLoginRoute
            ? "flex-1"
            : "flex-1 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))]"
        }
      >
        <Outlet />
      </main>

      {/* Bottom tab nav */}
      {!onLoginRoute && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[max(env(safe-area-inset-bottom),0.25rem)]">
          <ul className="grid grid-cols-5">
            {tabs.map((t) => (
              <li key={t.to}>
                <NavLink
                  to={t.to}
                  end={false}
                  className={({ isActive }) =>
                    [
                      "flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium",
                      isActive
                        ? "text-[#003087]"
                        : "text-slate-500 hover:text-slate-800",
                    ].join(" ")
                  }
                >
                  <t.icon active={false} />
                  <span>{t.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
};

const greet = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning,";
  if (h < 17) return "Good afternoon,";
  return "Good evening,";
};

// Tiny inline icons - avoids pulling another icon set just for the
// mobile shell.
function ListIcon(_: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" />
      <path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
    </svg>
  );
}
function ScanIcon(_: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </svg>
  );
}
function VerifyIcon(_: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4" />
      <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.27 0 4.34.84 5.93 2.22" />
    </svg>
  );
}
function UserIcon(_: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  );
}
function CountIcon(_: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 17h7" /><path d="M17 14v7" />
    </svg>
  );
}

export const useMobileShell = () => useMemo(() => ({}), []);
