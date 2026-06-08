import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Layers,
  Minus,
  Plus,
  Printer,
  Receipt,
  ScanLine,
  ScrollText,
  Search,
  Smartphone,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import { api, ApiError, type CustomerRow, type SalesOrderRow } from "@/lib/api";
import { ShareDocumentMenu } from "@/components/common/ShareDocumentMenu";
import { InvoiceDetail } from "@/components/billing/InvoiceDetail";
import { useApi } from "@/hooks/useApi";
import type { Invoice, Product, ProductVariant } from "@/data/types";
import { dd, dt, inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { effectivePrice, searchProductsForSale, variantLabel } from "@/lib/productSearch";

interface Line {
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  qty: number;
  price: number;
  uom: string;
  attributes: string;
  // When non-null, this line draws down a specific Sales Order line.
  salesOrderItemId?: string | null;
  // Maximum qty allowed (remaining on the SO line); ignored for walk-in.
  remaining?: number;
  // Pricing metadata
  resolvedPrice?: number;
  priceOrigin?: import("@/lib/api").PriceOrigin;
  priceListCode?: string;
}

const invTone = (s: Invoice["status"]) => {
  switch (s) {
    case "paid":
      return "success" as const;
    case "issued":
      return "primary" as const;
    case "partial":
      return "warning" as const;
    case "overdue":
      return "danger" as const;
    case "draft":
      return "neutral" as const;
  }
};

export const Billing = () => {
  const liveInvoices = useApi(() => api.invoices(), []);
  const liveProducts = useApi(() => api.products({ limit: 500 }), []);
  const liveCustomers = useApi<CustomerRow[]>(() => api.customers(), []);

  const invoices = liveInvoices.data ?? [];
  const products = liveProducts.data ?? [];
  const customers = liveCustomers.data ?? [];

  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"pos" | "invoices">(
    params.get("tab") === "invoices" ? "invoices" : "pos"
  );
  const focusInvoiceId = params.get("focus");
  // Drawer state: which invoice (if any) the user has clicked open.
  // Initialised from ?open=<id> so deep-linking from other pages works.
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(
    params.get("open")
  );

  // Keep tab + URL in sync.
  useEffect(() => {
    const current = params.get("tab");
    if (tab === "invoices" && current !== "invoices") {
      params.set("tab", "invoices");
      setParams(params, { replace: true });
    } else if (tab === "pos" && current === "invoices") {
      params.delete("tab");
      params.delete("focus");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [includeParentsAndRaw, setIncludeParentsAndRaw] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [pay, setPay] = useState<"cash" | "card" | "upi" | "split" | "credit">("upi");
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  // posError can be either a plain string (validation / generic) or a
  // structured "insufficient_stock" payload. Storing the API error object
  // lets the UI render the per-line short-stock breakdown.
  const [posError, setPosError] = useState<
    | string
    | {
        message: string;
        oversells: { sku: string; requested: number; available: number }[];
      }
    | null
  >(null);
  const [posOk, setPosOk] = useState<string | null>(null);
  const [soSource, setSoSource] = useState<SalesOrderRow | null>(null);
  const [soPickerOpen, setSoPickerOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!customerId && customers.length > 0) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const subTotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = Math.round(subTotal * 0.18);
  const total = subTotal + tax;

  const customer = customers.find((c) => c.id === customerId);

  // ---- Adding products ----
  const addLine = (p: Product, v: ProductVariant | null) => {
    const key = `${p.id}::${v?.id ?? "_"}`;
    const fallback = effectivePrice(p, v ?? undefined);
    setLines((prev) => {
      const found = prev.find((l) => `${l.productId}::${l.variantId ?? "_"}` === key);
      if (found) {
        const newQty = found.qty + 1;
        // Re-resolve in background to catch tier breaks
        void (async () => {
          try {
            const r = await api.resolvePrice({
              productId: p.id,
              variantId: v?.id ?? null,
              customerId: customerId || undefined,
              qty: newQty,
            });
            setLines((cur) =>
              cur.map((l) =>
                `${l.productId}::${l.variantId ?? "_"}` === key
                  ? {
                      ...l,
                      price: l.price === l.resolvedPrice ? r.price : l.price,
                      resolvedPrice: r.price,
                      priceOrigin: r.origin,
                      priceListCode: r.priceListCode,
                    }
                  : l
              )
            );
          } catch {/* */}
        })();
        return prev.map((l) =>
          `${l.productId}::${l.variantId ?? "_"}` === key ? { ...l, qty: newQty } : l
        );
      }
      // Add row with fallback price; resolver patches it shortly
      void (async () => {
        try {
          const r = await api.resolvePrice({
            productId: p.id,
            variantId: v?.id ?? null,
            customerId: customerId || undefined,
            qty: 1,
          });
          setLines((cur) =>
            cur.map((l) =>
              `${l.productId}::${l.variantId ?? "_"}` === key
                ? {
                    ...l,
                    price: r.price,
                    resolvedPrice: r.price,
                    priceOrigin: r.origin,
                    priceListCode: r.priceListCode,
                  }
                : l
            )
          );
        } catch {/* */}
      })();
      return [
        ...prev,
        {
          productId: p.id,
          variantId: v?.id ?? null,
          sku: v?.sku ?? p.sku,
          name: p.name,
          qty: 1,
          price: fallback,
          resolvedPrice: fallback,
          uom: p.uom,
          attributes: v ? variantLabel(v) : "",
        },
      ];
    });
    setPosError(null);
    setPosOk(null);
  };

  const addByCode = () => {
    const code = scan.trim();
    if (!code) return;
    let matchedProduct: Product | undefined;
    let matchedVariant: ProductVariant | null = null;

    for (const p of products) {
      if (p.barcode === code || p.sku.toLowerCase() === code.toLowerCase()) {
        matchedProduct = p;
        break;
      }
      const v = (p.variants ?? []).find(
        (vv) => vv.barcode === code || vv.sku.toLowerCase() === code.toLowerCase()
      );
      if (v) {
        matchedProduct = p;
        matchedVariant = v;
        break;
      }
    }
    if (matchedProduct) {
      addLine(matchedProduct, matchedVariant);
      setScan("");
    } else {
      setPosError(`No product found for "${code}".`);
    }
  };

  // ---- Text search results ----
  const searchResult = useMemo(
    () =>
      searchProductsForSale(products, search, { includeParentsAndRaw }),
    [search, products, includeParentsAndRaw]
  );
  const searchResults = searchResult.hits;

  const updateQty = (key: string, d: number) => {
    setLines((prev) =>
      prev
        .map((l) => {
          if (`${l.productId}::${l.variantId ?? "_"}` !== key) return l;
          const cap = l.remaining ?? Infinity;
          return { ...l, qty: Math.max(0, Math.min(cap, l.qty + d)) };
        })
        .filter((l) => l.qty > 0)
    );
  };

  const remove = (key: string) =>
    setLines((prev) => prev.filter((l) => `${l.productId}::${l.variantId ?? "_"}` !== key));

  // ---- Source selection ----
  const loadFromSalesOrder = (so: SalesOrderRow) => {
    setSoSource(so);
    setCustomerId(so.customerId);
    setSoPickerOpen(false);
    setPay("credit");
    const newLines: Line[] = so.items
      .filter((it) => it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled > 0)
      .map((it) => {
        const remaining = it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled;
        return {
          productId: it.productId,
          variantId: it.variantId ?? null,
          sku: it.variant?.sku ?? it.product?.sku ?? "—",
          name: it.product?.name ?? "—",
          qty: remaining,
          price: it.rate,
          uom: it.product?.uom ?? "Nos",
          attributes: it.variant
            ? [it.variant.size, it.variant.color, it.variant.grade]
                .filter(Boolean)
                .join(" · ")
            : "",
          salesOrderItemId: it.id,
          remaining,
        };
      });
    setLines(newLines);
    setPosError(null);
    setPosOk(null);
  };

  const clearSoSource = () => {
    setSoSource(null);
    setLines([]);
  };

  // ---- Charge ----
  const charge = async () => {
    if (lines.length === 0) {
      setPosError("Cart is empty.");
      return;
    }
    if (!customer) {
      setPosError("Select a customer.");
      return;
    }
    setSubmitting(true);
    setPosError(null);
    setPosOk(null);
    try {
      let invoiceNo: string;
      if (soSource) {
        const items = lines
          .filter((l) => l.salesOrderItemId && l.qty > 0)
          .map((l) => ({ salesOrderItemId: l.salesOrderItemId as string, qty: l.qty }));
        if (items.length === 0) {
          setPosError("No SO lines selected.");
          setSubmitting(false);
          return;
        }
        const inv = (await api.invoiceSalesOrder(soSource.id, {
          paymentMode: pay,
          items,
        })) as { invoiceNo?: string };
        invoiceNo = inv.invoiceNo ?? "(saved)";
      } else {
        const inv = (await api.createInvoice({
          customerId: customer.id,
          paymentMode: pay === "credit" ? "credit" : pay,
          items: lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            qty: l.qty,
            rate: l.price,
          })),
        })) as { invoiceNo?: string };
        invoiceNo = inv.invoiceNo ?? "(saved)";
      }
      setPosOk(`Invoice ${invoiceNo} created · ${inr(total)}`);
      setLines([]);
      setSoSource(null);
      void liveInvoices.refetch();
      void liveProducts.refetch();
    } catch (e) {
      // The server returns a structured 409 with code "insufficient_stock"
      // and a per-line `details` array when an invoice would oversell.
      // Surface that as a focused breakdown so the operator can fix the
      // exact lines without guessing.
      if (e instanceof ApiError && e.status === 409) {
        const det = e.details as
          | {
              code?: string;
              details?:
                | { sku: string; requested: number; available: number }[]
                | { invoiceId?: string; invoiceNo?: string };
            }
          | undefined;
        if (
          det?.code === "insufficient_stock" &&
          Array.isArray(det.details)
        ) {
          setPosError({
            message: e.message,
            oversells: det.details.map((d) => ({
              sku: d.sku,
              requested: d.requested,
              available: d.available,
            })),
          });
          return;
        }
        // Pre-generated invoice path: with the SO->Invoice rollout
        // every confirmed Sales Order is minted with an issued
        // invoice up-front, so trying to "draw down" a fresh
        // invoice from this screen is rejected. Point the operator
        // at the existing invoice instead of leaving them stuck.
        if (det?.code === "invoice_already_exists" && !Array.isArray(det.details)) {
          const linkId = det.details?.invoiceId;
          setPosError({
            message:
              e.message ??
              "This Sales Order already has a pre-generated invoice. Open the Invoices tab to settle it.",
            oversells: [],
          });
          if (linkId) {
            navigate(`/billing?tab=invoices&focus=${linkId}`);
          }
          return;
        }
      }
      const err = e as { message?: string };
      setPosError(err.message ?? "Charge failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredInvoices = useMemo(() => {
    if (!q) return invoices;
    const t = q.toLowerCase();
    return invoices.filter(
      (i) => i.invoiceNo.toLowerCase().includes(t) || i.customer.toLowerCase().includes(t)
    );
  }, [q, invoices]);

  const todayTotal = invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amount, 0);
  const overdueAmt = invoices
    .filter((i) => i.status === "overdue")
    .reduce((s, i) => s + i.amount, 0);

  const invCols: Column<Invoice>[] = [
    {
      key: "no",
      header: "Invoice",
      cell: (r) => (
        <span className="font-mono text-caption font-semibold text-primary">{r.invoiceNo}</span>
      ),
      width: "150px",
    },
    {
      key: "date",
      header: "Date",
      cell: (r) => <span className="text-ink-muted text-caption">{dt(r.date)}</span>,
      width: "130px",
      sortable: true,
      sortValue: (r) => r.date,
    },
    {
      key: "cust",
      header: "Customer",
      cell: (r) => <span className="font-semibold">{r.customer}</span>,
      sortable: true,
      sortValue: (r) => r.customer,
    },
    {
      key: "items",
      header: "Items",
      align: "center",
      cell: (r) => <span className="tnum">{r.itemCount}</span>,
      width: "70px",
    },
    {
      key: "tax",
      header: "Tax",
      align: "right",
      cell: (r) => <span className="tnum text-ink-muted">{inr(r.tax)}</span>,
      width: "110px",
    },
    {
      key: "amt",
      header: "Total",
      align: "right",
      cell: (r) => <span className="font-bold tnum">{inr(r.amount)}</span>,
      width: "130px",
      sortable: true,
      sortValue: (r) => r.amount,
    },
    {
      key: "pay",
      header: "Payment",
      cell: (r) => (
        <span className="capitalize text-caption text-ink-muted">{r.paymentMode}</span>
      ),
      width: "100px",
    },
    {
      key: "st",
      header: "Status",
      cell: (r) => (
        <Chip tone={invTone(r.status)} size="sm" className="capitalize">
          {r.status}
        </Chip>
      ),
      width: "100px",
    },
    {
      key: "share",
      header: "Share",
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ShareDocumentMenu
            size="sm"
            descriptor={{
              kind: "invoice",
              id: r.id,
              docNo: r.invoiceNo,
              shareToken: r.shareToken ?? null,
              customerName: r.customer,
              customerContact: r.customerContact ?? null,
              total: r.amount,
              contextLine: `Payment mode: ${r.paymentMode}\nIssued: ${dt(r.date)}`,
              rotateToken: async (id) =>
                (await api.rotateInvoiceShareToken(id)).shareToken,
              onTokenChanged: (token) => {
                r.shareToken = token;
              },
            }}
          />
        </div>
      ),
      width: "120px",
    },
  ];

  const initialLoading = liveProducts.loading || liveCustomers.loading;
  const initialError = liveProducts.error ?? liveCustomers.error;

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Billing</h2>
            <div className="flex items-center gap-1 ml-2">
              {(
                [
                  { id: "pos", label: "Point of Sale" },
                  { id: "invoices", label: "Invoices" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "h-7 px-3 rounded-md text-caption font-semibold transition-colors",
                    tab === t.id
                      ? "bg-primary text-white"
                      : "bg-canvas text-ink-muted hover:text-primary"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </>
        }
        right={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<ScrollText size={14} />}
              onClick={() => setSoPickerOpen(true)}
            >
              From Sales Order
            </Button>
            <Button variant="outline" size="sm" icon={<Receipt size={14} />}>
              Recent
            </Button>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => {
                setLines([]);
                setSoSource(null);
                setTab("pos");
              }}
            >
              New · F2
            </Button>
          </>
        }
      />

      {tab === "pos" ? (
        initialLoading || initialError ? (
          <EmptyState
            loading={initialLoading}
            error={initialError}
            onRetry={() => {
              liveProducts.refetch();
              liveCustomers.refetch();
            }}
          />
        ) : (
          <div className="flex-1 grid grid-cols-12 min-h-0 bg-canvas">
            <section className="col-span-7 xl:col-span-8 flex flex-col p-4 min-w-0">
              <Card
                title={
                  <div className="flex items-center gap-3">
                    <ScanLine size={18} className="text-primary" />
                    Scan or search to add
                  </div>
                }
                subtitle={
                  customer
                    ? `Counter 2 · ${customer.name}`
                    : "Counter 2 · pick a customer"
                }
                actions={<Chip tone="success">{lines.length} items</Chip>}
                className="!shadow-e2"
                bodyClassName="!pt-3"
              >
                {soSource && (
                  <div className="mb-3 px-3 py-2 bg-primary-50 border border-primary/20 rounded-md flex items-center gap-2 text-body-sm">
                    <ScrollText size={14} className="text-primary" />
                    <span>
                      Drawing down <strong>{soSource.soNo}</strong> ({soSource.customer.name}).
                      Edit qty per line; lines are capped at remaining qty.
                    </span>
                    <button
                      onClick={clearSoSource}
                      className="ml-auto h-6 w-6 grid place-items-center rounded text-ink-muted hover:bg-canvas"
                      title="Clear SO source"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    size="lg"
                    iconLeft={<ScanLine size={18} />}
                    placeholder={
                      soSource ? "Adding extra lines is disabled while drawing from SO" : "Scan barcode / SKU and press Enter"
                    }
                    disabled={!!soSource}
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addByCode()}
                    className="!font-mono"
                  />
                  <Button size="lg" onClick={addByCode} disabled={!!soSource}>
                    Add
                  </Button>
                </div>

                <div ref={searchRef} className="mt-3 relative">
                  <Input
                    size="lg"
                    iconLeft={<Search size={18} />}
                    placeholder="Search by name, SKU, size, color…"
                    value={search}
                    disabled={!!soSource}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => setSearchOpen(true)}
                  />
                  {!soSource && (
                    <label className="mt-2 flex items-center gap-2 text-body-sm text-ink-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeParentsAndRaw}
                        onChange={(e) => setIncludeParentsAndRaw(e.target.checked)}
                        className="rounded border-border"
                      />
                      Include parent SKUs &amp; raw materials
                    </label>
                  )}
                  {searchOpen && search.trim().length >= 2 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-surface border border-border rounded-md elevation-3 max-h-80 overflow-y-auto">
                      {searchResults.length === 0 ? (
                        <div className="p-4 text-caption text-ink-muted">
                          No products match "{search}".
                          {!includeParentsAndRaw && (
                            <span className="block mt-1">
                              Try enabling parent SKUs &amp; raw materials.
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          {searchResult.truncated && (
                            <div className="px-3 py-1.5 text-caption text-ink-muted border-b border-border bg-canvas">
                              Showing {searchResults.length} of {searchResult.totalMatches} — refine search to narrow
                            </div>
                          )}
                          {searchResults.map((r, i) => (
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
                                {r.variant && (
                                  <span className="ml-2 text-ink">· {r.label}</span>
                                )}
                              </div>
                            </div>
                            {r.rowKind === "variant" && (
                              <Chip size="sm" tone="info" icon={<Layers size={11} />}>
                                variant
                              </Chip>
                            )}
                            {r.rowKind === "parent" && (
                              <Chip size="sm" tone="warning">
                                parent
                              </Chip>
                            )}
                            {r.rowKind === "standalone" && r.product.type !== "finished" && (
                              <Chip size="sm" tone="neutral">
                                {r.product.type}
                              </Chip>
                            )}
                            <span className="font-bold tnum text-primary">{inr(r.price)}</span>
                          </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-3 border border-border rounded-md overflow-hidden">
                  <div className="grid grid-cols-12 grid-header-cell">
                    <div className="col-span-5">Item</div>
                    <div className="col-span-2 text-right">Price</div>
                    <div className="col-span-3 text-center">Qty</div>
                    <div className="col-span-2 text-right">Subtotal</div>
                  </div>
                  {lines.length === 0 && (
                    <div className="px-4 py-12 text-center text-ink-muted">
                      Empty cart. Scan, type SKU, or use the search box above.
                    </div>
                  )}
                  {lines.map((l) => {
                    const key = `${l.productId}::${l.variantId ?? "_"}`;
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-12 grid-cell items-center !py-2 hover:bg-canvas"
                      >
                        <div className="col-span-5">
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
                        <div className="col-span-2 text-right tnum">
                          {inr(l.price)}
                          {l.resolvedPrice != null &&
                            (Math.abs(l.price - l.resolvedPrice) > 0.01 ? (
                              <div className="text-caption text-danger">CUSTOM</div>
                            ) : l.priceListCode ? (
                              <div className="text-caption text-primary">
                                {l.priceListCode}
                                {l.priceOrigin === "list_override_tier" ? " tier" : ""}
                              </div>
                            ) : null)}
                        </div>
                        <div className="col-span-3 flex items-center justify-center gap-1">
                          <button
                            onClick={() => updateQty(key, -1)}
                            className="h-7 w-7 grid place-items-center rounded-md border border-border hover:bg-canvas text-ink-muted"
                          >
                            <Minus size={12} />
                          </button>
                          <input
                            value={l.qty}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((p) =>
                                  `${p.productId}::${p.variantId ?? "_"}` === key
                                    ? {
                                        ...p,
                                        qty: Math.max(
                                          0,
                                          Math.min(
                                            p.remaining ?? Number.MAX_SAFE_INTEGER,
                                            parseInt(e.target.value) || 0
                                          )
                                        ),
                                      }
                                    : p
                                )
                              )
                            }
                            className="h-7 w-14 text-center font-bold tnum border border-border rounded-md outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => updateQty(key, 1)}
                            className="h-7 w-7 grid place-items-center rounded-md border border-border hover:bg-canvas text-ink-muted"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                        <div className="col-span-2 text-right font-bold tnum flex items-center justify-end gap-2">
                          {inr(l.qty * l.price)}
                          <button
                            onClick={() => remove(key)}
                            className="h-6 w-6 grid place-items-center rounded text-ink-muted hover:text-danger"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {posError && (
                  <div className="mt-3 bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
                    {typeof posError === "string" ? (
                      posError
                    ) : (
                      <div>
                        <div className="font-semibold">{posError.message}</div>
                        <div className="mt-2 space-y-1 text-caption">
                          {posError.oversells.map((o, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between gap-3 bg-white/40 rounded px-2 py-1"
                            >
                              <span className="font-mono font-semibold">{o.sku}</span>
                              <span>
                                requested <b className="tnum">{o.requested}</b> · available{" "}
                                <b className="tnum">{o.available}</b> · short by{" "}
                                <b className="tnum text-danger">
                                  {o.requested - o.available}
                                </b>
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 text-caption text-ink-muted">
                          Reduce the qty on these lines, split the invoice, or run a
                          stock adjustment in Inventory before retrying.
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {posOk && (
                  <div className="mt-3 bg-success-soft border border-success text-success px-3 py-2 rounded-md text-body-sm flex items-center gap-2">
                    <CheckCircle2 size={14} /> {posOk}
                  </div>
                )}
              </Card>
            </section>

            <aside className="col-span-5 xl:col-span-4 bg-surface border-l border-border flex flex-col">
              <div className="p-4 flex-1 overflow-y-auto space-y-3">
                <div>
                  <div className="text-caption text-ink-muted uppercase font-semibold">
                    Customer
                  </div>
                  <select
                    className="mt-1 h-10 w-full bg-surface border border-border rounded-md px-2 text-body font-semibold disabled:opacity-60"
                    disabled={!!soSource}
                    value={customerId}
                    onChange={(e) => {
                      const newCustId = e.target.value;
                      setCustomerId(newCustId);
                      // Re-price all lines for the new customer
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
                            setLines((cur) =>
                              cur.map((l, i) => {
                                const r = resolved[i];
                                if (!r) return l;
                                return {
                                  ...l,
                                  price: l.price === l.resolvedPrice ? r.price : l.price,
                                  resolvedPrice: r.price,
                                  priceOrigin: r.origin,
                                  priceListCode: r.priceListCode,
                                };
                              })
                            );
                          } catch {/* */}
                        })();
                      }
                    }}
                  >
                    {customers.length === 0 && <option value="">— no customers —</option>}
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.priceList ? ` · ${c.priceList.code}` : ""}
                        {c.city ? ` · ${c.city}` : ""}
                      </option>
                    ))}
                  </select>
                  {customer?.gst && (
                    <div className="text-caption text-ink-muted mt-1">GST: {customer.gst}</div>
                  )}
                </div>
                <div className="border border-border rounded-md p-3 bg-canvas">
                  <Row k="Subtotal" v={inr(subTotal)} />
                  <Row k="GST 18%" v={inr(tax)} />
                  <Row k="Discount" v="—" />
                  <div className="border-t border-border my-2" />
                  <Row k="Total" v={inr(total)} big />
                </div>
                <div>
                  <div className="text-caption font-medium mb-1.5">Payment method</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: "upi", label: "UPI", icon: <Smartphone size={14} /> },
                        { id: "card", label: "Card", icon: <CreditCard size={14} /> },
                        { id: "cash", label: "Cash", icon: <Wallet size={14} /> },
                        { id: "credit", label: "Credit", icon: <Receipt size={14} /> },
                        { id: "split", label: "Split", icon: <IndianRupee size={14} /> },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setPay(m.id)}
                        className={cn(
                          "h-12 rounded-md border flex items-center gap-2 px-3 text-body-sm font-semibold transition-colors",
                          pay === m.id
                            ? "border-primary bg-primary-50 text-primary"
                            : "border-border hover:border-primary"
                        )}
                      >
                        {m.icon}
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="border-t border-border p-3 grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" icon={<Printer size={16} />}>
                  Print
                </Button>
                <Button
                  variant="gold"
                  size="lg"
                  icon={<Receipt size={16} />}
                  onClick={charge}
                  disabled={submitting || lines.length === 0 || !customer}
                >
                  {submitting ? "Charging…" : `Charge ${inr(total)}`}
                </Button>
              </div>
            </aside>
          </div>
        )
      ) : (
        <>
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 bg-canvas border-b border-border">
            <Kpi label="Today's Sales" value={inr(todayTotal)} delta={6.4} accent="success" />
            <Kpi
              label="Invoices Issued"
              value={String(invoices.length)}
              delta={3}
              deltaSuffix=""
              accent="primary"
            />
            <Kpi label="Overdue" value={inr(overdueAmt)} delta={-2.1} accent="danger" />
            <Kpi
              label="Avg Ticket"
              value={inr(Math.round(todayTotal / Math.max(1, invoices.length)))}
              delta={2}
              accent="primary"
            />
          </div>
          <div className="px-4 py-3 bg-surface border-b border-border flex items-center gap-3">
            <Input
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Search invoice, customer…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="!h-8"
            />
            <Button variant="outline" size="sm">
              Filters
            </Button>
            <span className="ml-auto text-caption text-ink-muted">
              {filteredInvoices.length} invoices
            </span>
          </div>
          {focusInvoiceId && (() => {
            const focused = invoices.find((i) => i.id === focusInvoiceId);
            return focused ? (
              <div className="px-4 py-2 bg-success-soft border-b border-success text-success text-body-sm flex items-center gap-2">
                <CheckCircle2 size={14} />
                Showing newly generated invoice <strong className="font-mono">{focused.invoiceNo}</strong> · {inr(focused.amount)}
                <button
                  className="ml-auto underline"
                  onClick={() => {
                    params.delete("focus");
                    setParams(params, { replace: true });
                  }}
                >
                  clear
                </button>
              </div>
            ) : null;
          })()}
          <div className="flex-1 min-h-0 overflow-auto bg-surface">
            {liveInvoices.loading || liveInvoices.error || filteredInvoices.length === 0 ? (
              <EmptyState
                loading={liveInvoices.loading}
                error={liveInvoices.error}
                empty={
                  !liveInvoices.loading &&
                  !liveInvoices.error &&
                  filteredInvoices.length === 0
                }
                emptyTitle="No invoices yet"
                emptyDescription="Create your first invoice from Point of Sale."
                onRetry={liveInvoices.refetch}
              />
            ) : (
              <DataTable
                rows={
                  focusInvoiceId
                    ? [
                        ...filteredInvoices.filter((r) => r.id === focusInvoiceId),
                        ...filteredInvoices.filter((r) => r.id !== focusInvoiceId),
                      ]
                    : filteredInvoices
                }
                columns={invCols}
                rowKey={(r) => r.id}
                onRowClick={(r) => setOpenInvoiceId(r.id)}
              />
            )}
          </div>
        </>
      )}

      {soPickerOpen && (
        <SalesOrderPicker
          onClose={() => setSoPickerOpen(false)}
          onPick={(so) => loadFromSalesOrder(so)}
        />
      )}

      {openInvoiceId && (
        <InvoiceDetail
          invoiceId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
          onChanged={() => {
            void liveInvoices.refetch();
          }}
        />
      )}
    </div>
  );
};

interface PickerProps {
  onClose: () => void;
  onPick: (so: SalesOrderRow) => void;
}

const SalesOrderPicker = ({ onClose, onPick }: PickerProps) => {
  const live = useApi(
    () => api.salesOrders({ status: "confirmed", limit: 100 }),
    []
  );
  const partial = useApi(
    () => api.salesOrders({ status: "partially_invoiced", limit: 100 }),
    []
  );
  const [filter, setFilter] = useState("");

  const sos = useMemo(() => {
    const all = [...(live.data ?? []), ...(partial.data ?? [])];
    const term = filter.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (s) =>
        s.soNo.toLowerCase().includes(term) ||
        s.customer?.name.toLowerCase().includes(term)
    );
  }, [live.data, partial.data, filter]);

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-center" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col rounded-md elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Pick a Sales Order
            </div>
            <div className="text-h3 font-bold">Open / partially invoiced SOs</div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-2 border-b border-border">
          <Input
            size="sm"
            iconLeft={<Search size={14} />}
            placeholder="Filter SO no. / customer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {live.loading || partial.loading ? (
            <div className="p-6 text-center text-ink-muted">Loading…</div>
          ) : sos.length === 0 ? (
            <div className="p-6 text-center text-ink-muted">No open Sales Orders.</div>
          ) : (
            sos.map((s) => {
              const ord = (s.items ?? []).reduce(
                (n, it) => n + ("qtyOrdered" in it ? it.qtyOrdered : 0),
                0
              );
              const inv = (s.items ?? []).reduce(
                (n, it) => n + ("qtyInvoiced" in it ? it.qtyInvoiced : 0),
                0
              );
              return (
                <button
                  key={s.id}
                  onClick={() => onPick(s)}
                  className="w-full px-4 py-3 border-b last:border-b-0 border-border hover:bg-canvas text-left flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-semibold text-primary">{s.soNo}</div>
                    <div className="text-body-sm">{s.customer.name}</div>
                    <div className="text-caption text-ink-muted">
                      {dd(s.orderDate)} · {inv}/{ord} invoiced
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold tnum">{inr(s.total)}</div>
                    <Chip size="sm" tone="primary" className="capitalize mt-1">
                      {s.status.replace(/_/g, " ")}
                    </Chip>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const Row = ({ k, v, big }: { k: string; v: string; big?: boolean }) => (
  <div className="flex items-center justify-between py-1">
    <span className={cn("text-body-sm", big ? "font-bold text-ink" : "text-ink-muted")}>{k}</span>
    <span
      className={cn("tnum", big ? "text-h2 font-bold text-primary" : "font-semibold text-ink")}
    >
      {v}
    </span>
  </div>
);
