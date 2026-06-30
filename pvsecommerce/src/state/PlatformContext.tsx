// Detects whether we're running inside a Capacitor native app or a
// narrow phone viewport, and exposes the iOS safe-area insets so
// components can anchor above the home indicator / notch.
//
// - isPhone: true when viewport width ≤ 720 px (phone / small tablet)
// - isApp:   true when running inside Capacitor (real device or emulator)
// - isIOS:   true when running on iOS Capacitor

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface PlatformValue {
  isPhone: boolean;
  isTablet: boolean;
  isApp: boolean;
  isIOS: boolean;
}

const PlatformContext = createContext<PlatformValue>({
  isPhone: false,
  isTablet: false,
  isApp: false,
  isIOS: false,
});

const PHONE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

const detectIsApp = (): boolean => {
  // Capacitor sets window.Capacitor after its bridge script loads.
  if (typeof window === "undefined") return false;
  return !!(window as unknown as Record<string, unknown>)["Capacitor"];
};

const detectIsIOS = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
};

export const PlatformProvider = ({ children }: { children: ReactNode }) => {
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.innerWidth < PHONE_BREAKPOINT
  );
  const [isTablet, setIsTablet] = useState(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth >= PHONE_BREAKPOINT &&
      window.innerWidth <= TABLET_BREAKPOINT
  );
  const isApp = useMemo(() => detectIsApp(), []);
  const isIOS = useMemo(() => detectIsIOS(), []);

  const handleResize = useCallback(() => {
    const w = window.innerWidth;
    setIsPhone(w < PHONE_BREAKPOINT);
    setIsTablet(w >= PHONE_BREAKPOINT && w <= TABLET_BREAKPOINT);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  // On iOS app, add safe-area padding to the root element so CSS
  // env() variables are respected without extra per-component effort.
  useEffect(() => {
    if (isApp && isIOS) {
      document.documentElement.classList.add("ios-app");
    }
    if (isApp) {
      document.documentElement.classList.add("native-app");
    }
  }, [isApp, isIOS]);

  const value = useMemo<PlatformValue>(
    () => ({ isPhone, isTablet, isApp, isIOS }),
    [isPhone, isTablet, isApp, isIOS]
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
};

export const usePlatform = (): PlatformValue => useContext(PlatformContext);
