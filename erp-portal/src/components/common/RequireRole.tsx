// RequireRole — wraps a page route and shows a 403 screen if the current
// user's role isn't in the allowed list. This prevents direct URL access
// to modules the user's role doesn't permit even if the nav is hidden.
//
// Usage:
//   <RequireRole roles={["admin","billing"]}>
//     <BillingPage />
//   </RequireRole>

import type { ReactNode } from "react";
import { ShieldOff } from "lucide-react";
import { auth } from "@/lib/api";

interface Props {
  roles: string[];
  children: ReactNode;
}

export const RequireRole = ({ roles, children }: Props) => {
  const role = auth.user()?.role ?? "";
  if (role === "admin" || roles.includes(role)) {
    return <>{children}</>;
  }
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-ink-muted">
      <ShieldOff size={40} className="text-danger" />
      <div className="text-h3 font-semibold text-ink">Access Denied</div>
      <div className="text-body max-w-sm text-center">
        Your role <strong>({role || "unknown"})</strong> does not have permission
        to access this module. Contact your administrator.
      </div>
    </div>
  );
};
