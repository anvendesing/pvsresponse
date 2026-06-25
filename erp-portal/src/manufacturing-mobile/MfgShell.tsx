import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { auth } from "../lib/api";
import { installApp, isStandalone, onInstallReadyChange } from "../pwa/install";
import { useDeviceFacility } from "./useDeviceFacility";

// =====================================================================
// MfgShell — Manufacturing PWA shell
// =====================================================================
// Mirrors mobile/MobileShell.tsx but the device is pinned to a
// ProductionFacility (a "room") instead of a warehouse. Three tabs:
//   - Room      : MOs assigned to this room, materials & work signals
//   - Transfers : incoming TRFs to this room's production-line WH
//   - Profile   : user, room, logout / switch room
//
// Same PIN auth flow as /m/* — different localStorage keys so the two
// PWAs don't fight over device assignment.

const tabs = [
  { to: "/mfg/room", label: "Room", icon: HomeIcon },
  { to: "/mfg/transfers", label: "Transfers", icon: TruckIcon },
  { to: "/mfg/profile", label: "Profile", icon: UserIcon },
] as const;

export const MfgShell = () => {
  const location = useLocation();
  const nav = useNavigate();
  const facility = useDeviceFacility();
  const user = auth.user();
  const [installReady, setInstallReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => onInstallReadyChange(setInstallReady), []);

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

  const onLoginRoute = location.pathname === "/mfg/login";

  useEffect(() => {
    if (!auth.token() && !onLoginRoute) {
      nav("/mfg/login", { replace: true });
    }
  }, [location.pathname, onLoginRoute, nav]);

  useEffect(() => {
    if (auth.token() && !facility && !onLoginRoute) {
      nav("/mfg/login", { replace: true });
    }
  }, [facility, onLoginRoute, nav]);

  const installVisible = installReady && !isStandalone();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900">
      {!onLoginRoute && (
        <header className="sticky top-0 z-30 flex items-center justify-between bg-[#003087] px-4 py-3 text-white shadow-sm pt-[max(env(safe-area-inset-top),0.75rem)]">
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-xs uppercase tracking-wider opacity-80 truncate">
              {facility?.code ?? "no room"}
            </span>
            <span className="text-base font-semibold truncate">
              {greet()} {user?.name?.split(" ")[0] ?? "Worker"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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

      <main
        className={
          onLoginRoute
            ? "flex-1"
            : "flex-1 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))]"
        }
      >
        <Outlet />
      </main>

      {!onLoginRoute && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[max(env(safe-area-inset-bottom),0.25rem)]">
          <ul className="grid grid-cols-3">
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
                  <t.icon />
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

function HomeIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="6" width="14" height="11" rx="1" />
      <path d="M15 9h4l3 4v4h-7" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  );
}
