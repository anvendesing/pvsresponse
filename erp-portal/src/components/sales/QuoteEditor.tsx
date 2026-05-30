// Right-side drawer editor for Quote create / edit. Modeled on
// ProductEditor + the Billing typeahead. While editing a submitted quote
// a banner reminds the operator that saving will create a new revision.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, History, Layers, Plus, Search, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import {
  api,
  type AcceptQuoteResponse,
  type AtpResult,
  type CustomerRow,
  type QuoteCreatePayload,
  type QuoteRow,
} from "@/lib/api";
import type { Product, ProductVariant } from "@/data/types";
import { inr, dd } from "@/lib/format";
import { cn } from "@/lib/cn";
import { RevisionHistory } from "./RevisionHistory";
import { ShareQuoteMenu } from "./ShareQuoteMenu";

type Mode = "create" | "edit";

interface Props {
  open: boolean;
  mode: Mode;
  quote?: QuoteRow | null;
  customers: CustomerRow[];
  products: Product[];
  onClose: () => void;
  onSaved: (q: QuoteRow) => void;
  onAccepted?: (resp: AcceptQuoteResponse) => void;
  // Optional deep-link to the Approvals page (for credit-hold cases). Receives
  // the approval id so the host page can pre-select it.
  onNavigateToApprovals?: (approvalId?: string) => void;
  // Notified after a draft quote is hard-deleted so the parent list can
  // refresh and remove the row.
  onDeleted?: (q: QuoteRow) => void;
}

interface Line {
  // Local-only key for keyed list reconciliation
  key: string;
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  uom: string;
  attributes: string;
  qty: number;
  rate: number;
  discount: number;
  // Pricing metadata for the chip
  priceOrigin?: import("@/lib/api").PriceOrigin;
  priceListCode?: string;
  // List/formula price for this qty - if operator's `rate` differs from
  // this then we flag the line as CUSTOM (negotiated override).
  resolvedPrice?: number;
}

const variantLabel = (v: ProductVariant) =>
  [v.size, v.color, v.grade].filter(Boolean).join(" · ") || "default";

const effectivePrice = (p: Product, v?: ProductVariant) =>
  v?.sellingPriceOverride ?? p.sellingPrice;

const lineKey = (productId: string, variantId: string | null) =>
  `${productId}::${variantId ?? "_"}::${Math.random().toString(36).slice(2, 6)}`;

const linesFromQuote = (q: QuoteRow): Line[] =>
  q.items.map((it) => ({
    key: lineKey(it.productId, it.variantId ?? null),
    productId: it.productId,
    variantId: it.variantId ?? null,
    sku: it.variant?.sku ?? it.product?.sku ?? "—",
    name: it.product?.name ?? "—",
    // Variant UoM (the selling unit) wins over parent UoM (the bulk unit)
    // so quotes/invoices are denominated in the unit the customer buys.
    uom: (it.variant?.uom ?? "").trim() || it.product?.uom || "Nos",
    attributes: it.variant ? variantLabel(it.variant as ProductVariant) : "",
    qty: it.qty,
    rate: it.rate,
    discount: it.discount,
  }));

const customerHeadroom = async (
  customer: CustomerRow & { creditLimit?: number },
  draftTotal: number
) => {
  // We don't have a dedicated endpoint for open balance. Skip the live
  // computation here; show the credit limit and the draft total — the
  // server is the authority on whether acceptance breaches the limit.
  return {
    limit: customer.creditLimit ?? 0,
    draftTotal,
  };
};

export const QuoteEditor = ({
  open,
  mode,
  quote,
  customers,
  products,
  onClose,
  onSaved,
  onAccepted,
  onNavigateToApprovals,
  onDeleted,
}: Props) => {
  const [customerId, setCustomerId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRevisions, setShowRevisions] = useState(false);
  const [atpCache, setAtpCache] = useState<Record<string, AtpResult>>({});
  const searchRef = useRef<HTMLDivElement | null>(null);

  const isSubmitted = mode === "edit" && quote && quote.status === "submitted";
  const isLocked =
    mode === "edit" &&
    quote &&
    ["accepted", "converted", "rejected"].includes(quote.status);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setShowRevisions(false);
    setAtpCache({});
    if (mode === "edit" && quote) {
      setCustomerId(quote.customerId);
      setValidUntil(quote.validUntil.slice(0, 10));
      setPaymentTerms(quote.paymentTerms ?? "");
      setNotes(quote.notes ?? "");
      setLines(linesFromQuote(quote));
    } else {
      setCustomerId(customers[0]?.id ?? "");
      const d = new Date(Date.now() + 30 * 86400000);
      setValidUntil(d.toISOString().slice(0, 10));
      setPaymentTerms("Net 30");
      setNotes("");
      setLines([]);
    }
  }, [open, mode, quote, customers]);

  // Click-away for typeahead
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const customer = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId]
  );

  // If we're editing a quote whose customer is now INACTIVE (e.g. it was
  // soft-deleted after the quote was drafted) the master list won't include
  // it, so the dropdown can't display the current value and the editor
  // becomes unusable. Splice the quote's own customer record (carried by
  // the QuoteRow) onto the list so it's selectable, with an "(inactive)"
  // tag that's visible in the dropdown.
  const customerOptions = useMemo(() => {
    const list = [...customers];
    if (
      mode === "edit" &&
      quote?.customer &&
      !list.some((c) => c.id === quote.customer.id)
    ) {
      list.unshift({
        ...quote.customer,
        active: false,
      } as CustomerRow);
    }
    return list;
  }, [customers, mode, quote]);

  // ---- Totals ----
  const subTotal = useMemo(
    () => lines.reduce((s, l) => s + l.qty * l.rate * (1 - l.discount / 100), 0),
    [lines]
  );
  const tax = useMemo(() => {
    // Resolve effective GST rate per line from the products prop.
    const productMap = new Map((products ?? []).map((p) => [p.id, p]));
    const lineTaxes = lines.map((l) => {
      const amount = l.qty * l.rate * (1 - l.discount / 100);
      const product = productMap.get(l.productId);
      const variant = product?.variants?.find((v) => v.id === l.variantId);
      const rate = (variant?.gstRate ?? null) ?? product?.gstRate ?? 18;
      return amount * (rate / 100);
    });
    return Math.round(lineTaxes.reduce((s, t) => s + t, 0));
  }, [lines, products]);
  const total = subTotal + tax;

  const headroom = useMemo(() => {
    if (!customer) return null;
    return customerHeadroom(customer, total);
  }, [customer, total]);

  // ---- Search ----
  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length < 2) return [];
    const out: { product: Product; variant: ProductVariant | null; label: string; price: number }[] = [];
    for (const p of products) {
      const baseHit =
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.barcode.includes(term) ||
        (p.category?.name ?? "").toLowerCase().includes(term);
      if (baseHit) {
        out.push({ product: p, variant: null, label: "default", price: p.sellingPrice });
      }
      for (const v of p.variants ?? []) {
        const vHit =
          v.sku.toLowerCase().includes(term) ||
          (v.barcode ?? "").includes(term) ||
          (v.size ?? "").toLowerCase().includes(term) ||
          (v.color ?? "").toLowerCase().includes(term) ||
          (v.grade ?? "").toLowerCase().includes(term);
        if (vHit || baseHit) {
          out.push({
            product: p,
            variant: v,
            label: variantLabel(v),
            price: effectivePrice(p, v),
          });
        }
      }
      if (out.length > 30) break;
    }
    return out.slice(0, 12);
  }, [search, products]);

  // ---- Mutations ----
  // Resolves the customer-aware price from the backend. Falls back to the
  // product's default sellingPrice if the call fails.
  const resolvePriceFor = async (
    productId: string,
    variantId: string | null,
    qty: number
  ) => {
    try {
      const r = await api.resolvePrice({
        productId,
        variantId,
        customerId: customerId || undefined,
        qty,
      });
      return r;
    } catch {
      return null;
    }
  };

  const addLine = async (p: Product, v: ProductVariant | null) => {
    const fallback = effectivePrice(p, v ?? undefined);
    const newLine: Line = {
      key: lineKey(p.id, v?.id ?? null),
      productId: p.id,
      variantId: v?.id ?? null,
      sku: v?.sku ?? p.sku,
      name: p.name,
      // Variant selling UoM takes priority; falls back to parent UoM when
      // the variant doesn't override (the "inherit" case).
      uom: (v?.uom ?? "").trim() || p.uom,
      attributes: v ? variantLabel(v) : "",
      qty: 1,
      rate: fallback,
      discount: 0,
      resolvedPrice: fallback,
    };
    setLines((prev) => [...prev, newLine]);
    setError(null);
    void prefetchAtp(p.id, v?.id ?? null);
    // Apply customer-aware price (asynchronously, so the row appears instantly)
    const resolved = await resolvePriceFor(p.id, v?.id ?? null, 1);
    if (resolved) {
      setLines((prev) =>
        prev.map((l) =>
          l.key === newLine.key
            ? {
                ...l,
                rate: resolved.price,
                resolvedPrice: resolved.price,
                priceOrigin: resolved.origin,
                priceListCode: resolved.priceListCode,
              }
            : l
        )
      );
    }
  };

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    // If qty changes, re-resolve in the background to pick up tier breaks.
    if (patch.qty != null) {
      const line = lines.find((l) => l.key === key);
      if (line) {
        void (async () => {
          const r = await resolvePriceFor(line.productId, line.variantId, patch.qty!);
          if (!r) return;
          setLines((prev) =>
            prev.map((l) =>
              l.key === key && r.price !== l.resolvedPrice
                ? {
                    ...l,
                    // Only auto-update rate if operator hasn't manually overridden
                    rate: l.rate === l.resolvedPrice ? r.price : l.rate,
                    resolvedPrice: r.price,
                    priceOrigin: r.origin,
                    priceListCode: r.priceListCode,
                  }
                : l
            )
          );
        })();
      }
    }
  };

  const removeLine = (key: string) =>
    setLines((prev) => prev.filter((l) => l.key !== key));

  // ---- ATP per-line ----
  const prefetchAtp = async (productId: string, variantId: string | null) => {
    const k = `${productId}::${variantId ?? "_"}`;
    if (atpCache[k]) return;
    try {
      const r = await api.atp(productId, variantId);
      setAtpCache((prev) => ({ ...prev, [k]: r }));
    } catch {
      // ignore - chip just won't show
    }
  };

  useEffect(() => {
    for (const l of lines) prefetchAtp(l.productId, l.variantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.map((l) => l.productId + (l.variantId ?? "")).join("|")]);

  const atpFor = (l: Line) => atpCache[`${l.productId}::${l.variantId ?? "_"}`];
  const atpTone = (atp: number, qty: number) => {
    if (atp >= qty) return "success" as const;
    if (atp >= qty * 0.5) return "warning" as const;
    return "danger" as const;
  };

  // ---- Validation + submit ----
  const canSave = !!customerId && lines.length > 0 && !submitting && !isLocked;

  const buildPayload = (): QuoteCreatePayload => ({
    customerId,
    validUntil: new Date(validUntil + "T23:59:59").toISOString(),
    paymentTerms: paymentTerms || null,
    notes: notes || null,
    items: lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      qty: l.qty,
      rate: l.rate,
      discount: l.discount,
    })),
  });

  const save = async (alsoSubmit = false) => {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = buildPayload();
      let saved: QuoteRow;
      if (mode === "create") {
        saved = await api.createQuote(payload);
      } else if (quote) {
        saved = await api.updateQuote(quote.id, {
          ...payload,
          reason: isSubmitted ? "edit" : undefined,
        });
      } else {
        throw new Error("Missing quote in edit mode");
      }
      if (alsoSubmit && saved.status === "draft") {
        saved = await api.submitQuote(saved.id);
      }
      onSaved(saved);
      if (!alsoSubmit) onClose();
    } catch (e) {
      setError((e as Error).message ?? "Save failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const accept = async () => {
    if (!quote) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.acceptQuote(quote.id);
      onAccepted?.(r);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Accept failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const reject = async () => {
    if (!quote) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.rejectQuote(quote.id);
      onSaved(updated);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Reject failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // Hard-delete a draft quote. The backend rejects this on any non-draft
  // status, so the button is only rendered for drafts.
  const remove = async () => {
    if (!quote) return;
    if (
      !window.confirm(
        `Delete draft ${quote.quoteNo}? This cannot be undone. (Submitted quotes must be Rejected instead to keep audit history.)`
      )
    )
      return;
    setSubmitting(true);
    setError(null);
    try {
      await api.deleteQuote(quote.id);
      onDeleted?.(quote);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Delete failed.");
      setSubmitting(false);
    }
  };

  // Admin override for credit-hold quotes. Skips the credit-limit gate, marks
  // the pending approval as approved, and materialises the SO in one call.
  const forceConvert = async () => {
    if (!quote) return;
    const ok = window.confirm(
      `Override credit hold for ${quote.customer.name} and create a Sales Order for ${inr(
        quote.total
      )}?\n\nThis bypasses the credit-limit policy and will be logged as a manual override.`
    );
    if (!ok) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.forceConvertQuote(quote.id);
      // Adapt to the AcceptQuoteResponse shape so the parent can show its
      // standard "Sales Order created" banner and refresh the list.
      onAccepted?.({
        id: r.salesOrder.id,
        soNo: r.salesOrder.soNo,
        status: r.salesOrder.status,
        total: r.salesOrder.total,
        salesOrder: r.salesOrder,
        alreadyConverted: r.alreadyConverted,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Override failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-end" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-4xl h-full overflow-hidden flex flex-col elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              {mode === "create" ? "New Quote" : `Quote · rev ${quote?.revision}`}
            </div>
            <div className="text-h3 font-bold flex items-center gap-2">
              {quote?.quoteNo ?? "Draft"}
              {quote && (
                <Chip size="sm" tone={statusTone(quote.status)} className="capitalize">
                  {quote.status}
                </Chip>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === "edit" && quote && (quote.revisions?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant="outline"
                icon={<History size={14} />}
                onClick={() => setShowRevisions(true)}
              >
                History ({quote.revisions?.length ?? 0})
              </Button>
            )}
            <button
              onClick={onClose}
              className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {isSubmitted && (
          <div className="bg-warning-soft border-b border-warning text-ink px-5 py-2 text-body-sm">
            Editing a submitted quote will create a new revision; the previous one is kept in
            history.
          </div>
        )}
        {/*
          Credit-hold banner. Shown when the operator clicked Accept but the
          customer's credit limit was breached -> the SO is parked behind a
          Credit Limit approval. Without this banner the user sees status
          "accepted" with no SO and assumes the system is broken.
        */}
        {quote &&
          quote.status === "accepted" &&
          !quote.convertedSalesOrderId && (
            <div className="bg-warning-soft border-b border-warning px-5 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-body-sm font-bold text-ink">
                    Sales Order on hold — credit-limit approval required
                  </div>
                  <div className="text-caption text-ink-muted mt-0.5">
                    {quote.pendingApproval?.reason ??
                      `Customer ${quote.customer.name} would exceed their credit limit. The conversion is parked until an approver grants the override.`}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {quote.pendingApproval && onNavigateToApprovals && (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<ExternalLink size={14} />}
                      onClick={() => onNavigateToApprovals(quote.pendingApproval?.id)}
                    >
                      View approval
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Zap size={14} />}
                    onClick={forceConvert}
                    disabled={submitting}
                  >
                    {submitting ? "…" : "Override & convert"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        {isLocked && quote?.status !== "accepted" && (
          <div className="bg-canvas border-b border-border text-ink-muted px-5 py-2 text-body-sm">
            This quote is in <strong>{quote?.status}</strong> and cannot be edited. Create a new
            quote instead.
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
              {error}
            </div>
          )}

          <section className="grid grid-cols-2 gap-3">
            <Field label="Customer *">
              <select
                disabled={isLocked || (mode === "edit" && quote?.status === "submitted")}
                className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm"
                value={customerId}
                onChange={(e) => {
                  const newCustId = e.target.value;
                  setCustomerId(newCustId);
                  // Re-price every line for the new customer
                  if (lines.length > 0) {
                    void (async () => {
                      try {
                        const resolved = await api.resolvePrices({
                          customerId: newCustId,
                          items: lines.map((l) => ({
                            productId: l.productId,
                            variantId: l.variantId,
                            qty: l.qty,
                          })),
                        });
                        setLines((prev) =>
                          prev.map((l, i) => {
                            const r = resolved[i];
                            if (!r) return l;
                            return {
                              ...l,
                              rate: l.rate === l.resolvedPrice ? r.price : l.rate,
                              resolvedPrice: r.price,
                              priceOrigin: r.origin,
                              priceListCode: r.priceListCode,
                            };
                          })
                        );
                      } catch {
                        /* ignore */
                      }
                    })();
                  }
                }}
              >
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.active === false ? " (inactive)" : ""}
                    {c.priceList ? ` · ${c.priceList.code}` : ""}
                    {c.city ? ` · ${c.city}` : ""}
                  </option>
                ))}
              </select>
              {customer && headroom && (
                <div className="text-caption text-ink-muted mt-1">
                  Credit limit: <strong>{inr((customer as { creditLimit?: number }).creditLimit ?? 0)}</strong> ·
                  This quote: <strong>{inr(total)}</strong>
                </div>
              )}
            </Field>
            <Field label="Valid until *">
              <Input
                type="date"
                disabled={!!isLocked}
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
              {validUntil && (
                <div className="text-caption text-ink-muted mt-1">
                  {dd(validUntil)} ({Math.max(0, Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86400000))}d)
                </div>
              )}
            </Field>
            <Field label="Payment terms">
              <Input
                disabled={!!isLocked}
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="Net 30 / Advance / etc."
              />
            </Field>
            <Field label="Notes">
              <Input
                disabled={!!isLocked}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Free-form remarks"
              />
            </Field>
          </section>

          <section ref={searchRef} className="border-t border-border pt-4 relative">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-h3 font-bold">Line items</div>
                <div className="text-caption text-ink-muted">
                  Type to search products, SKUs, sizes or grades.
                </div>
              </div>
              <Chip tone="info" size="sm">
                {lines.length} {lines.length === 1 ? "line" : "lines"}
              </Chip>
            </div>
            {!isLocked && (
              <Input
                size="sm"
                iconLeft={<Search size={14} />}
                placeholder="Search products / variants…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
              />
            )}
            {searchOpen && search.trim().length >= 2 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-surface border border-border rounded-md elevation-3 max-h-72 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="p-4 text-caption text-ink-muted">
                    No products match "{search}".
                  </div>
                ) : (
                  searchResults.map((r, i) => (
                    <button
                      key={`${r.product.id}-${r.variant?.id ?? "_"}-${i}`}
                      className="w-full px-3 py-2 flex items-center gap-3 hover:bg-canvas text-left"
                      onClick={() => {
                        addLine(r.product, r.variant);
                        setSearch("");
                        setSearchOpen(false);
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{r.product.name}</div>
                        <div className="text-caption text-ink-muted font-mono truncate">
                          {r.variant ? r.variant.sku : r.product.sku}
                          {r.variant && <span className="ml-2 text-ink">· {r.label}</span>}
                        </div>
                      </div>
                      {r.variant && (
                        <Chip size="sm" tone="info" icon={<Layers size={11} />}>
                          variant
                        </Chip>
                      )}
                      <span className="font-bold tnum text-primary">{inr(r.price)}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {lines.length === 0 ? (
              <div className="mt-3 text-caption text-ink-muted bg-canvas border border-border rounded-md p-4 text-center">
                No lines yet. Search for products above to add them.
              </div>
            ) : (
              <div className="mt-3 border border-border rounded-md overflow-hidden">
                <div className="grid grid-cols-12 grid-header-cell text-caption">
                  <div className="col-span-4">Item</div>
                  <div className="col-span-1 text-right">Qty</div>
                  <div className="col-span-2 text-right">Rate</div>
                  <div className="col-span-1 text-right">Disc%</div>
                  <div className="col-span-2 text-right">Amount</div>
                  <div
                    className="col-span-2 text-center cursor-help"
                    title="Available to Promise = on-hand stock − qty reserved on open Sales Orders + open Purchase Order receipts + open Production output. Tells you how many units you can safely commit to this quote without breaking other promises."
                  >
                    ATP
                  </div>
                </div>
                {lines.map((l) => {
                  const atp = atpFor(l);
                  const amount = l.qty * l.rate * (1 - l.discount / 100);
                  return (
                    <div
                      key={l.key}
                      className="grid grid-cols-12 grid-cell items-center !py-2 hover:bg-canvas"
                    >
                      <div className="col-span-4">
                        <div className="font-semibold flex items-center gap-2">
                          {l.name}
                          {l.attributes && (
                            <Chip size="sm" tone="info">
                              {l.attributes}
                            </Chip>
                          )}
                        </div>
                        <div className="text-caption text-ink-muted font-mono">
                          {l.sku} · {l.uom}
                        </div>
                      </div>
                      <div className="col-span-1">
                        <Input
                          type="number"
                          disabled={!!isLocked}
                          value={String(l.qty)}
                          onChange={(e) =>
                            updateLine(l.key, { qty: Math.max(0, Number(e.target.value)) })
                          }
                          className="!h-7 !text-right tnum"
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          disabled={!!isLocked}
                          value={String(l.rate)}
                          onChange={(e) =>
                            updateLine(l.key, { rate: Math.max(0, Number(e.target.value)) })
                          }
                          className="!h-7 !text-right tnum"
                        />
                        <PriceOriginChip line={l} />
                      </div>
                      <div className="col-span-1">
                        <Input
                          type="number"
                          disabled={!!isLocked}
                          value={String(l.discount)}
                          onChange={(e) =>
                            updateLine(l.key, {
                              discount: Math.max(0, Math.min(100, Number(e.target.value))),
                            })
                          }
                          className="!h-7 !text-right tnum"
                        />
                      </div>
                      <div className="col-span-2 text-right tnum font-semibold">
                        {inr(amount)}
                      </div>
                      <div className="col-span-2 flex items-center justify-center gap-1">
                        {atp ? (
                          <span
                            title={`Available to Promise: ${atp.atp} ${l.uom}\n\nOn hand:           ${atp.onHand}\n− Reserved on SOs: ${atp.reservedForSO}\n+ Open POs:        ${atp.openProcurement}\n+ Open production: ${atp.openProduction}\n──────────────────────\nATP:               ${atp.atp}\n\n${atp.atp >= l.qty ? "OK to promise this quantity." : `Short by ${l.qty - atp.atp} ${l.uom}.`}`}
                            className="cursor-help inline-flex"
                          >
                            <Chip
                              size="sm"
                              tone={atpTone(atp.atp, l.qty)}
                            >
                              ATP {atp.atp}
                            </Chip>
                          </span>
                        ) : (
                          <span className="text-caption text-ink-muted">…</span>
                        )}
                        {!isLocked && (
                          <button
                            onClick={() => removeLine(l.key)}
                            className="h-6 w-6 grid place-items-center rounded text-ink-muted hover:text-danger"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="border-t border-border pt-4">
            <div className="grid grid-cols-2 gap-x-8 max-w-md ml-auto text-body-sm">
              <Row k="Subtotal" v={inr(subTotal)} />
              <Row k="GST" v={inr(tax)} />
              <Row k="Total" v={inr(total)} big />
            </div>
          </section>
        </div>

        <div className="border-t border-border p-3 flex items-center gap-2 justify-end">
          {/* Share menu is available the moment a quote exists (any status
              except "draft" still allows sharing, but for cash-and-carry
              drafts there's no customer to share with anyway). */}
          {mode === "edit" && quote && (
            <>
              <ShareQuoteMenu
                quote={quote}
                size="sm"
                onTokenChanged={(t) => {
                  // Keep parent's in-memory QuoteRow up to date so we don't
                  // re-mint on next open.
                  if (quote) (quote as { shareToken?: string }).shareToken = t;
                }}
              />
              <div className="w-px h-6 bg-border mx-1" />
            </>
          )}
          {mode === "edit" && quote?.status === "submitted" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={reject}
                disabled={submitting}
                className={cn("border-danger text-danger hover:bg-danger-soft")}
              >
                Reject
              </Button>
              <Button size="sm" variant="primary" onClick={accept} disabled={submitting}>
                {submitting ? "…" : "Accept → Sales Order"}
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
            </>
          )}
          {mode === "edit" && quote?.status === "draft" && (
            <>
              <Button
                size="sm"
                variant="outline"
                icon={<Trash2 size={14} />}
                onClick={remove}
                disabled={submitting}
                className={cn("border-danger text-danger hover:bg-danger-soft")}
              >
                Delete
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {mode === "create" ? (
            <>
              <Button size="sm" variant="outline" onClick={() => save(false)} disabled={!canSave}>
                Save draft
              </Button>
              <Button size="sm" onClick={() => save(true)} disabled={!canSave}>
                {submitting ? "Saving…" : "Save & Submit"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => save(false)} disabled={!canSave}>
              {submitting ? "Saving…" : isSubmitted ? "Save (creates revision)" : "Save"}
            </Button>
          )}
        </div>
      </div>

      {quote && showRevisions && (
        <RevisionHistory quoteId={quote.id} onClose={() => setShowRevisions(false)} />
      )}
    </div>
  );
};

const statusTone = (s: QuoteRow["status"]): "neutral" | "primary" | "success" | "warning" | "danger" => {
  switch (s) {
    case "draft":
      return "neutral";
    case "submitted":
      return "primary";
    case "accepted":
      return "success";
    case "converted":
      return "success";
    case "rejected":
      return "danger";
    case "expired":
      return "warning";
  }
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="text-caption text-ink-muted uppercase tracking-wide font-semibold mb-1">
      {label}
    </div>
    {children}
  </div>
);

const Row = ({ k, v, big }: { k: string; v: string; big?: boolean }) => (
  <>
    <span className={cn(big ? "text-body font-bold" : "text-ink-muted")}>{k}</span>
    <span className={cn("text-right tnum", big ? "text-h3 font-bold text-primary" : "font-semibold")}>{v}</span>
  </>
);

// Small chip under each row's rate input showing where the price came
// from. CUSTOM (red) means the operator has overridden the resolver -
// makes negotiations visible at a glance.
const PriceOriginChip = ({
  line,
}: {
  line: {
    rate: number;
    resolvedPrice?: number;
    priceOrigin?: import("@/lib/api").PriceOrigin;
    priceListCode?: string;
  };
}) => {
  if (line.resolvedPrice == null) return null;
  const isCustom = Math.abs(line.rate - line.resolvedPrice) > 0.01;
  if (isCustom) {
    return (
      <div className="text-caption text-danger text-right mt-0.5">
        CUSTOM · was {inr(line.resolvedPrice)}
      </div>
    );
  }
  if (!line.priceOrigin || line.priceOrigin === "product_default") {
    return <div className="text-caption text-ink-muted text-right mt-0.5">MRP</div>;
  }
  const label =
    line.priceOrigin === "list_override_tier"
      ? `${line.priceListCode} · tier`
      : line.priceOrigin === "list_override"
        ? `${line.priceListCode} · override`
        : line.priceOrigin === "list_formula"
          ? `${line.priceListCode} · formula`
          : "variant";
  return <div className="text-caption text-primary text-right mt-0.5">{label}</div>;
};
