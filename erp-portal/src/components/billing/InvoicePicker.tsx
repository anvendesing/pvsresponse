// Simple modal that lists "issued" invoices (i.e. anything not draft and
// not paid-in-full-with-no-goods-pending) so the operator can pick one
// to dispatch against. Used by the Transport page's "Plan dispatch"
// flow as the entry point when the operator doesn't already have an
// invoice open.

import { useEffect, useMemo, useState } from "react";
import { Receipt, Search, X } from "lucide-react";
import { Input } from "@/components/common/Input";
import { Chip } from "@/components/common/Chip";
import { api } from "@/lib/api";
import type { Invoice } from "@/data/types";
import { dt, inr } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Props {
  onClose: () => void;
  onPick: (invoice: Invoice) => void;
}

export const InvoicePicker = ({ onClose, onPick }: Props) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await api.invoices();
        if (!cancelled) setInvoices(all);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // We exclude draft invoices because the backend rejects dispatch
  // creation for them. Everything else is fair game (operators may want
  // to dispatch overdue or partially-paid invoices too).
  const dispatchable = useMemo(
    () => invoices.filter((i) => i.status !== "draft"),
    [invoices]
  );

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    if (!term) return dispatchable;
    return dispatchable.filter(
      (i) =>
        i.invoiceNo.toLowerCase().includes(term) ||
        i.customer.toLowerCase().includes(term)
    );
  }, [dispatchable, q]);

  return (
    <div className="fixed inset-0 z-[55] bg-ink/40 grid place-items-center" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-2xl max-h-[80vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Receipt size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Pick an invoice
              </div>
              <div className="text-body-sm">to dispatch goods against</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border bg-canvas">
          <Input
            autoFocus
            placeholder="Search invoice number or customer…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            iconLeft={<Search size={14} />}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-ink-muted">Loading invoices…</div>
          ) : error ? (
            <div className="p-6 text-center text-danger">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-ink-muted">
              {dispatchable.length === 0
                ? "No issued invoices to dispatch yet."
                : "No invoices match your search."}
            </div>
          ) : (
            filtered.map((inv) => (
              <button
                key={inv.id}
                onClick={() => onPick(inv)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-border/60 hover:bg-canvas transition-colors",
                  "grid grid-cols-12 items-center gap-3"
                )}
              >
                <div className="col-span-3 font-mono text-body-sm font-semibold text-primary">
                  {inv.invoiceNo}
                </div>
                <div className="col-span-4 truncate">
                  <div className="font-semibold">{inv.customer}</div>
                  <div className="text-caption text-ink-muted">{dt(inv.date)}</div>
                </div>
                <div className="col-span-2 text-right tnum font-bold">
                  {inr(inv.amount)}
                </div>
                <div className="col-span-3 text-right">
                  <Chip
                    size="sm"
                    tone={
                      inv.status === "paid"
                        ? "success"
                        : inv.status === "overdue"
                          ? "danger"
                          : inv.status === "partial"
                            ? "warning"
                            : "primary"
                    }
                    className="capitalize"
                  >
                    {inv.status}
                  </Chip>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
