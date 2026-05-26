// Bottom-right toast notifications. Driven through context so any
// component can fire `useToast().show(...)`.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface Toast {
  id: number;
  variant: "default" | "success" | "error";
  message: string;
}

interface ToastContextValue {
  show: (message: string, variant?: Toast["variant"]) => void;
  toasts: Toast[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback(
    (message: string, variant: Toast["variant"] = "default") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    []
  );

  const value = useMemo<ToastContextValue>(() => ({ show, toasts }), [show, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} />
    </ToastContext.Provider>
  );
};

const ToastViewport = ({ toasts }: { toasts: Toast[] }) => (
  <div className="toast-container" aria-live="polite" aria-atomic="true">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={`toast ${t.variant === "success" ? "success" : ""} ${t.variant === "error" ? "error" : ""}`}
      >
        {t.message}
      </div>
    ))}
  </div>
);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
};
