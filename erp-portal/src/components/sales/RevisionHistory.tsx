// Side panel that lists every snapshot for a quote and renders a simple
// header/items diff between any two adjacent revisions. Snapshots are
// stored verbatim on the server so what you see is exactly what the
// quote looked like at that revision.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { api, type QuoteRevisionRow } from "@/lib/api";
import type { Product } from "@/data/types";
import { dt, inr } from "@/lib/format";
import { cn } from "@/lib/cn";

// Build a "Product Name · variant attrs" label from a productId / variantId
// using the catalog map. Falls back to a short id stub when the catalog is
// still loading or the SKU was deleted.
const labelFor = (
  productId: string,
  variantId: string | null | undefined,
  productMap: Map<string, Product>
): { primary: string; secondary?: string } => {
  const p = productMap.get(productId);
  if (!p) return { primary: `${productId.slice(0, 8)}…` };
  if (!variantId) return { primary: p.name, secondary: p.sku };
  const v = p.variants?.find((vv) => vv.id === variantId);
  if (!v) return { primary: p.name, secondary: `${p.sku} · variant ${variantId.slice(0, 6)}…` };
  const axes = [v.size, v.color, v.grade].filter((x) => x && String(x).trim()).join(" · ");
  return {
    primary: p.name,
    secondary: axes || v.sku,
  };
};

interface Props {
  quoteId: string;
  onClose: () => void;
}

interface QuoteSnapshotItem {
  productId: string;
  variantId?: string | null;
  qty: number;
  rate: number;
  discount: number;
  amount: number;
}

interface QuoteSnapshot {
  quoteNo: string;
  revision: number;
  status: string;
  total: number;
  subTotal: number;
  tax: number;
  validUntil: string;
  paymentTerms?: string | null;
  notes?: string | null;
  items: QuoteSnapshotItem[];
}

const parseSnapshot = (raw: string): QuoteSnapshot => {
  try {
    return JSON.parse(raw) as QuoteSnapshot;
  } catch {
    return {
      quoteNo: "(corrupt snapshot)",
      revision: 0,
      status: "?",
      total: 0,
      subTotal: 0,
      tax: 0,
      validUntil: "",
      paymentTerms: null,
      notes: null,
      items: [],
    };
  }
};

const lineKey = (it: QuoteSnapshotItem) => `${it.productId}::${it.variantId ?? "_"}`;

interface Diff {
  field: string;
  before?: string | number | null;
  after?: string | number | null;
  kind: "added" | "removed" | "changed";
}

const diffSnapshots = (
  a: QuoteSnapshot,
  b: QuoteSnapshot,
  productMap: Map<string, Product>
): Diff[] => {
  const out: Diff[] = [];
  const fields: (keyof QuoteSnapshot)[] = [
    "validUntil",
    "paymentTerms",
    "notes",
    "subTotal",
    "tax",
    "total",
  ];
  for (const f of fields) {
    const va = a[f];
    const vb = b[f];
    if ((va ?? "") !== (vb ?? "")) {
      out.push({
        field: f,
        before: va as string | number | null,
        after: vb as string | number | null,
        kind: "changed",
      });
    }
  }
  const aMap = new Map(a.items.map((it) => [lineKey(it), it] as const));
  const bMap = new Map(b.items.map((it) => [lineKey(it), it] as const));
  const renderLine = (it: QuoteSnapshotItem) => {
    const l = labelFor(it.productId, it.variantId, productMap);
    return l.secondary ? `${l.primary} (${l.secondary})` : l.primary;
  };
  for (const [k, ait] of aMap) {
    const bit = bMap.get(k);
    if (!bit) {
      out.push({
        field: renderLine(ait),
        before: `qty ${ait.qty} @ ${ait.rate}`,
        kind: "removed",
      });
    } else if (ait.qty !== bit.qty || ait.rate !== bit.rate || ait.discount !== bit.discount) {
      out.push({
        field: renderLine(ait),
        before: `qty ${ait.qty} @ ${ait.rate} -${ait.discount}%`,
        after: `qty ${bit.qty} @ ${bit.rate} -${bit.discount}%`,
        kind: "changed",
      });
    }
  }
  for (const [, bit] of bMap) {
    if (!aMap.has(lineKey(bit))) {
      out.push({
        field: renderLine(bit),
        after: `qty ${bit.qty} @ ${bit.rate}`,
        kind: "added",
      });
    }
  }
  return out;
};

export const RevisionHistory = ({ quoteId, onClose }: Props) => {
  const [revisions, setRevisions] = useState<QuoteRevisionRow[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [r, ps] = await Promise.all([
          api.quoteRevisions(quoteId),
          api.products({ limit: 500 }),
        ]);
        if (!cancelled) {
          setRevisions(r);
          setProducts(ps);
          if (r.length > 0) setPicked(r[r.length - 1].revision);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  // Memoized product-id -> Product map for fast label lookups.
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const snapshot = useMemo<QuoteSnapshot | null>(() => {
    if (!revisions || picked === null) return null;
    const r = revisions.find((x) => x.revision === picked);
    return r ? parseSnapshot(r.snapshot) : null;
  }, [revisions, picked]);

  const previous = useMemo<QuoteSnapshot | null>(() => {
    if (!revisions || picked === null) return null;
    const ordered = [...revisions].sort((a, b) => a.revision - b.revision);
    const idx = ordered.findIndex((x) => x.revision === picked);
    if (idx <= 0) return null;
    return parseSnapshot(ordered[idx - 1].snapshot);
  }, [revisions, picked]);

  const diffs = useMemo(
    () => (previous && snapshot ? diffSnapshots(previous, snapshot, productMap) : []),
    [previous, snapshot, productMap]
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/60 grid place-items-end"
      {...backdropDismissProps(onClose)}
    >
      <div
        className="bg-surface w-full max-w-2xl h-full overflow-hidden flex flex-col elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Revision History
            </div>
            <div className="text-h3 font-bold">
              {revisions ? `${revisions.length} snapshots` : "Loading…"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-12 min-h-0">
          <aside className="col-span-4 border-r border-border overflow-y-auto bg-canvas">
            {error && (
              <div className="m-3 bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
                {error}
              </div>
            )}
            {(revisions ?? []).map((r) => (
              <button
                key={r.id}
                onClick={() => setPicked(r.revision)}
                className={cn(
                  "w-full text-left px-3 py-2 border-b border-border hover:bg-surface",
                  picked === r.revision && "bg-surface"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">rev {r.revision}</div>
                  <Chip size="sm" tone="info" className="capitalize">
                    {r.reason.replace(/_/g, " ")}
                  </Chip>
                </div>
                <div className="text-caption text-ink-muted mt-0.5">
                  {dt(r.changedAt)} · {r.changedByUser?.name ?? r.changedByUser?.username ?? "—"}
                </div>
              </button>
            ))}
            {revisions && revisions.length === 0 && (
              <div className="p-4 text-caption text-ink-muted">
                No prior revisions yet.
              </div>
            )}
          </aside>

          <section className="col-span-8 overflow-y-auto p-5 space-y-4">
            {snapshot ? (
              <>
                <div className="border border-border rounded-md p-3 bg-canvas">
                  <div className="flex items-center gap-3 text-body-sm">
                    <strong>{snapshot.quoteNo}</strong>
                    <span className="text-ink-muted">·</span>
                    <span className="capitalize">{snapshot.status}</span>
                    <span className="text-ink-muted">·</span>
                    <span className="font-bold tnum">{inr(snapshot.total)}</span>
                  </div>
                  <div className="text-caption text-ink-muted mt-1">
                    Valid until {snapshot.validUntil ? snapshot.validUntil.slice(0, 10) : "—"}
                  </div>
                </div>

                <div>
                  <div className="text-caption text-ink-muted uppercase font-semibold mb-2">
                    Items at rev {snapshot.revision}
                  </div>
                  <div className="border border-border rounded-md overflow-hidden">
                    <div className="grid grid-cols-12 grid-header-cell text-caption">
                      <div className="col-span-6">Product</div>
                      <div className="col-span-2 text-right">Qty</div>
                      <div className="col-span-2 text-right">Rate</div>
                      <div className="col-span-2 text-right">Amount</div>
                    </div>
                    {snapshot.items.map((it, i) => {
                      const label = labelFor(it.productId, it.variantId, productMap);
                      return (
                        <div key={i} className="grid grid-cols-12 grid-cell !py-2 text-body-sm">
                          <div className="col-span-6 min-w-0">
                            <div className="font-medium truncate">{label.primary}</div>
                            {label.secondary && (
                              <div className="text-caption text-ink-muted truncate">
                                {label.secondary}
                              </div>
                            )}
                          </div>
                          <div className="col-span-2 text-right tnum">{it.qty}</div>
                          <div className="col-span-2 text-right tnum">{inr(it.rate)}</div>
                          <div className="col-span-2 text-right tnum font-semibold">
                            {inr(it.amount)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {previous && diffs.length > 0 && (
                  <div>
                    <div className="text-caption text-ink-muted uppercase font-semibold mb-2 flex items-center gap-2">
                      Diff vs rev {previous.revision} <ArrowRight size={12} /> rev{" "}
                      {snapshot.revision}
                    </div>
                    <div className="space-y-1.5">
                      {diffs.map((d, i) => (
                        <div
                          key={i}
                          className={cn(
                            "border rounded-md px-3 py-2 text-body-sm",
                            d.kind === "added" && "border-success bg-success-soft",
                            d.kind === "removed" && "border-danger bg-danger-soft",
                            d.kind === "changed" && "border-warning bg-warning-soft"
                          )}
                        >
                          <div className="font-semibold capitalize">{d.field}</div>
                          {d.before !== undefined && (
                            <div className="text-caption text-ink-muted">
                              before: <code>{String(d.before)}</code>
                            </div>
                          )}
                          {d.after !== undefined && (
                            <div className="text-caption">
                              after: <code className="font-bold">{String(d.after)}</code>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-ink-muted">Select a revision on the left.</div>
            )}
          </section>
        </div>

        <div className="border-t border-border p-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
