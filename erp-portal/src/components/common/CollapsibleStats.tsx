import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Wraps a module's KPI grid in a collapsible band so high-volume pages
 * (Inventory, Warehouse, Manufacturing) can reclaim the ~140px the
 * 4-card stat strip otherwise burns. The user's open/closed preference
 * is persisted per page via localStorage, keyed by `storageKey`.
 *
 * When collapsed, only a slim ~32px header remains, with a small
 * inline summary (e.g. "4 stats") so users still know there's
 * something here.
 */
interface Props {
  storageKey: string;
  title?: ReactNode;
  // Quick one-liner summary shown next to the toggle when collapsed
  // (e.g. "Stock: ₹4.2L · 1,250 units · 12 low"). Keeps the at-a-glance
  // affordance even when the rich cards are hidden.
  summary?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

const readPersistedOpen = (storageKey: string, fallback: boolean): boolean => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`stats-open:${storageKey}`);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // localStorage can throw in privacy mode; silently fall through.
  }
  return fallback;
};

export const CollapsibleStats = ({
  storageKey,
  title = "Stats",
  summary,
  defaultOpen = true,
  className,
  children,
}: Props) => {
  const [open, setOpen] = useState<boolean>(() => readPersistedOpen(storageKey, defaultOpen));

  useEffect(() => {
    try {
      window.localStorage.setItem(`stats-open:${storageKey}`, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [storageKey, open]);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  return (
    <div className={cn("bg-canvas border-b border-border shrink-0", className)}>
      <div className="flex items-center gap-3 px-4 py-1.5">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-1.5 text-caption uppercase tracking-wide text-ink-muted hover:text-ink"
          aria-expanded={open}
        >
          <LayoutGrid size={12} />
          <span className="font-semibold">{title}</span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {!open && summary && (
          <span className="text-caption text-ink-muted truncate min-w-0">{summary}</span>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={toggle}
            className="text-caption text-ink-muted hover:text-ink font-medium"
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
};
