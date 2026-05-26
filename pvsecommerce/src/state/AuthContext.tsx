// Dummy auth. The customer dashboard / order history needs *some*
// way to identify "you", but real auth is out of scope for the demo.
// We collect name/email/phone from the login form, persist them to
// localStorage, and treat that as a logged-in session. Backend
// endpoints are public; the email is sent along with order-history
// requests so the customer only sees their own orders.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "pv_auth_v1";

export interface AuthUser {
  name: string;
  email: string;
  phone: string;
}

const readStored = (): AuthUser | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (
      parsed &&
      typeof parsed.name === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.phone === "string"
    ) {
      return parsed;
    }
  } catch {
    /* noop */
  }
  return null;
};

interface AuthContextValue {
  user: AuthUser | null;
  isAuthed: boolean;
  signIn: (u: AuthUser) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(() => readStored());

  useEffect(() => {
    try {
      if (user) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* noop */
    }
  }, [user]);

  const signIn = useCallback((u: AuthUser) => {
    setUser({
      name: u.name.trim(),
      email: u.email.trim().toLowerCase(),
      phone: u.phone.trim(),
    });
  }, []);

  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthed: user !== null, signIn, signOut }),
    [user, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
