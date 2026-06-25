import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TrendingDown, TrendingUp } from "lucide-react";

interface KpiProps {
  label: string;
  value: ReactNode;
  delta?: number;
  deltaSuffix?: string;
  icon?: ReactNode;
  hint?: string;
  accent?: "primary" | "success" | "warning" | "danger" | "none";
  className?: string;
}

const accentMap = {
  primary: "border-l-4 border-l-primary",
  success: "border-l-4 border-l-success",
  warning: "border-l-4 border-l-warning",
  danger: "border-l-4 border-l-danger",
  none: "",
};

export const Kpi = ({
  label,
  value,
  delta,
  deltaSuffix = "%",
  icon,
  hint,
  accent = "primary",
  className,
}: KpiProps) => {
  const positive = delta !== undefined && delta >= 0;
  return (
    <div
      className={cn(
        "bg-surface border border-border rounded-lg shadow-e1 p-4 flex flex-col gap-2 min-w-0",
        accentMap[accent],
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-ink-muted truncate uppercase tracking-wide">
          {label}
        </span>
        {icon && <span className="text-primary shrink-0">{icon}</span>}
      </div>
      <div className="text-amount text-ink tnum leading-none">{value}</div>
      <div className="flex items-center justify-between gap-2 text-caption">
        {delta !== undefined ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-semibold",
              positive ? "text-success" : "text-danger"
            )}
          >
            {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {positive ? "+" : ""}
            {delta}
            {deltaSuffix}
          </span>
        ) : (
          <span />
        )}
        {hint && <span className="text-ink-muted truncate">{hint}</span>}
      </div>
    </div>
  );
};
