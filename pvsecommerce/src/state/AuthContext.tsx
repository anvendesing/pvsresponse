import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type CustomerAddress, type StorefrontCustomer } from "@/lib/api";
import { AUTH_TOKEN_KEY } from "@/lib/auth-storage";
import { tokenStorage } from "@/lib/native";

// Synchronous read from localStorage for the initial render (Preferences
// is async; we hydrate the async value in useEffect below).
const readTokenSync = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
};

interface AuthContextValue {
  token: string | null;
  customer: StorefrontCustomer | null;
  addresses: CustomerAddress[];
  isAuthed: boolean;
  loading: boolean;
  requestOtp: (phone: string, purpose?: "login" | "track") => Promise<{ devOtp?: string; resendInSec?: number }>;
  verifyOtp: (phone: string, code: string, name?: string, purpose?: "login" | "track") => Promise<void>;
  refreshMe: () => Promise<void>;
  signOut: () => void;
  setAddresses: (rows: CustomerAddress[]) => void;
  /** @deprecated use customer */
  user: { name: string; email: string; phone: string } | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => readTokenSync());
  const [customer, setCustomer] = useState<StorefrontCustomer | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(Boolean(readTokenSync()));

  // On native (Capacitor) the authoritative store is Preferences (survives
  // WebView reinstalls on iOS). We sync it to state on first mount.
  useEffect(() => {
    tokenStorage.getItem(AUTH_TOKEN_KEY).then((stored) => {
      if (stored && !token) {
        setToken(stored);
        setLoading(true);
      }
    }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistToken = useCallback((next: string | null) => {
    setToken(next);
    void tokenStorage.setItem(AUTH_TOKEN_KEY, next ?? "").catch(() => undefined);
    if (!next) void tokenStorage.removeItem(AUTH_TOKEN_KEY).catch(() => undefined);
    // Keep localStorage in sync so the sync readTokenSync() path still works on web.
    try {
      if (next) window.localStorage.setItem(AUTH_TOKEN_KEY, next);
      else window.localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch { /* noop */ }
  }, []);

  const refreshMe = useCallback(async () => {
    const t = readTokenSync();
    if (!t) {
      setCustomer(null);
      setAddresses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const me = await api.me();
      setCustomer(me.customer);
      setAddresses(me.addresses);
    } catch {
      persistToken(null);
      setCustomer(null);
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  }, [persistToken]);

  useEffect(() => {
    if (token) void refreshMe();
    else setLoading(false);
  }, [token, refreshMe]);

  const requestOtp = useCallback(async (phone: string, purpose: "login" | "track" = "login") => {
    const res = await api.sendOtp(phone, purpose);
    return { devOtp: res.devOtp, resendInSec: res.resendInSec };
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, code: string, name?: string, purpose: "login" | "track" = "login") => {
      const res = await api.verifyOtp(phone, code, name, purpose);
      persistToken(res.token);
      setCustomer(res.customer);
      setAddresses(res.addresses);
    },
    [persistToken]
  );

  const signOut = useCallback(() => {
    persistToken(null);
    setCustomer(null);
    setAddresses([]);
    void api.logout().catch(() => undefined);
  }, [persistToken]);

  const legacyUser = useMemo(() => {
    if (!customer) return null;
    return {
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
    };
  }, [customer]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      customer,
      addresses,
      isAuthed: Boolean(token && customer),
      loading,
      requestOtp,
      verifyOtp,
      refreshMe,
      signOut,
      setAddresses,
      user: legacyUser,
    }),
    [
      token,
      customer,
      addresses,
      loading,
      requestOtp,
      verifyOtp,
      refreshMe,
      signOut,
      legacyUser,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
