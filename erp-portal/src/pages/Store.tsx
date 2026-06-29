// Mock storefront page. Lives at /store and is intentionally outside
// the WorkspaceProvider/Shell wrapper so the public-facing route does
// not show the ERP chrome (sidebar, command palette, status bar).
//
// What this page demonstrates:
//   1. A visitor enters their contact details and picks variants from
//      a catalog. No login - the backend creates a CustomerAccount on
//      submit if one does not yet exist for the email.
//   2. Clicking "Place prepaid order" hits POST /v1/storefront-mock/order
//      which creates the Customer/Account, the SalesOrder
//      (status=confirmed, source=ecommerce), the paid Invoice, the
//      stock decrement, and a draft PickList - all in a single request.
//   3. Success card shows the document numbers (SO / Invoice / PickList)
//      with deep links to the regular ERP screens so QA can confirm the
//      pipeline picked the order up.
//
// This file is NOT a real e-commerce store. It is a sandbox to verify
// that prepaid orders flow through the existing pick/pack/dispatch
// pipeline without a parallel codepath. Cart state is in-memory only;
// reloading wipes it. No payment gateway, no login, no addresses.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { aggregateLineTaxes, computeLineTax } from "@/lib/documentTax";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(
  /\/$/,
  ""
);
const MOCK_TOKEN = (import.meta.env.VITE_MOCK_STOREFRONT_TOKEN as string | undefined) ?? "";

// =====================================================================
// Types matching the catalog endpoint shape.
// =====================================================================
interface Variant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  grade: string | null;
  uom: string | null;
  packSize: number;
  stockOnHand: number;
  price: number;
}

interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  uom: string;
  sellingPrice: number;
  stockOnHand: number;
  variants: Variant[];
}

interface CartLine {
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  variantSku: string | null;
  qty: number;
  rate: number;
  available: number;
}

interface OrderResult {
  customer: { id: string; code: string; name: string };
  customerAccount: { id: string; email: string };
  salesOrder: {
    id: string;
    soNo: string;
    status: string;
    total: number;
    shareToken: string | null;
  };
  invoice: {
    id: string;
    invoiceNo: string;
    amount: number;
    status: string;
    shareToken: string | null;
  };
  pickList:
    | { id: string; pickListNo: string }
    | { error: { code: string; message: string } };
}

const inr = (n: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n
  );

// =====================================================================
// Page component.
// =====================================================================
export const Store = () => {
  const [customer, setCustomer] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    notes: "",
  });
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderResult | null>(null);

  const [pricingIncludesGst, setPricingIncludesGst] = useState(false);

  useEffect(() => {
    if (!API_URL) return;
    fetch(`${API_URL}/v1/settings/company`, {
      headers: MOCK_TOKEN ? { Authorization: `Bearer ${MOCK_TOKEN}` } : {},
    })
      .then(async (r) => (r.ok ? ((await r.json()) as { pricingIncludesGst?: boolean }) : null))
      .then((p) => setPricingIncludesGst(p?.pricingIncludesGst ?? false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!API_URL) {
      setCatalogError("VITE_API_URL is not set; backend is unreachable.");
      return;
    }
    fetch(`${API_URL}/v1/storefront-mock/catalog`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`catalog ${r.status}`);
        return (await r.json()) as CatalogProduct[];
      })
      .then(setCatalog)
      .catch((e: unknown) => setCatalogError((e as Error).message));
  }, []);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.variants.some((v) => v.sku.toLowerCase().includes(q))
    );
  }, [catalog, search]);

  const posTotals = useMemo(() => {
    const taxKind = "intra" as const;
    const lines = cart.map((l) =>
      computeLineTax(
        { qty: l.qty, rate: l.rate, gstRate: 18 },
        { inclusive: pricingIncludesGst, taxKind }
      )
    );
    const agg = aggregateLineTaxes(lines);
    return { ...agg, total: agg.subTotal + agg.tax };
  }, [cart, pricingIncludesGst]);

  const subTotal = posTotals.subTotal;
  const tax = posTotals.tax;
  const cgstTotal = posTotals.cgstTotal;
  const sgstTotal = posTotals.sgstTotal;
  const total = posTotals.total;

  const addToCart = (p: CatalogProduct, v: Variant): void => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.variantId === v.id);
      if (idx >= 0) {
        const next = [...prev];
        const want = Math.min(next[idx].qty + 1, v.stockOnHand);
        next[idx] = { ...next[idx], qty: want };
        return next;
      }
      return [
        ...prev,
        {
          productId: p.id,
          productSku: p.sku,
          productName: p.name,
          variantId: v.id,
          variantSku: v.sku,
          qty: 1,
          rate: v.price,
          available: v.stockOnHand,
        },
      ];
    });
  };

  const setQty = (variantId: string, qty: number): void => {
    setCart((prev) => {
      if (qty <= 0) return prev.filter((l) => l.variantId !== variantId);
      return prev.map((l) =>
        l.variantId === variantId
          ? { ...l, qty: Math.min(qty, l.available) }
          : l
      );
    });
  };

  const removeLine = (variantId: string): void => {
    setCart((prev) => prev.filter((l) => l.variantId !== variantId));
  };

  const placeOrder = async (): Promise<void> => {
    setOrderError(null);
    if (!customer.name.trim() || !customer.email.trim() || !customer.phone.trim()) {
      setOrderError("Name, email, and phone are required.");
      return;
    }
    if (cart.length === 0) {
      setOrderError("Add at least one line to the cart.");
      return;
    }
    setBusy(true);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (MOCK_TOKEN) headers["x-mock-token"] = MOCK_TOKEN;
      const r = await fetch(`${API_URL}/v1/storefront-mock/order`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: customer.name.trim(),
          email: customer.email.trim(),
          phone: customer.phone.trim(),
          city: customer.city.trim() || undefined,
          notes: customer.notes.trim() || undefined,
          items: cart.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            qty: l.qty,
          })),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setOrderError(body?.error?.message ?? `Order failed (${r.status}).`);
        return;
      }
      setOrder(body as OrderResult);
      setCart([]);
    } catch (e) {
      setOrderError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // =====================================================================
  // Render.
  // =====================================================================
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              PVS Storefront
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                Mock
              </span>
            </h1>
            <p className="text-sm text-slate-600">
              Place a prepaid test order. Customer + invoice + pick list are
              created in one shot; warehouse picks up the pick list in the
              normal flow.
            </p>
          </div>
          <Link
            to="/dashboard"
            className="text-sm text-blue-700 hover:underline"
          >
            ← Back to ERP
          </Link>
        </header>

        {order ? (
          <SuccessCard
            order={order}
            onAnother={() => {
              setOrder(null);
              setOrderError(null);
            }}
          />
        ) : (
          <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
            {/* Catalog and customer info */}
            <div className="space-y-6">
              <CustomerForm value={customer} onChange={setCustomer} />
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold">Catalog</h2>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search SKU / name"
                    className="w-56 rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                {catalogError && (
                  <div className="rounded bg-red-50 p-3 text-sm text-red-800">
                    Could not load catalog: {catalogError}
                  </div>
                )}
                {!catalog && !catalogError && (
                  <div className="text-sm text-slate-500">Loading…</div>
                )}
                {catalog && filtered.length === 0 && (
                  <div className="text-sm text-slate-500">
                    No in-stock products match.
                  </div>
                )}
                <div className="space-y-3">
                  {filtered.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      onAdd={(v) => addToCart(p, v)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Cart */}
            <CartPanel
              cart={cart}
              subTotal={subTotal}
              tax={tax}
              cgstTotal={cgstTotal}
              sgstTotal={sgstTotal}
              total={total}
              busy={busy}
              error={orderError}
              onQty={setQty}
              onRemove={removeLine}
              onPlace={placeOrder}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// =====================================================================
// Sub-components.
// =====================================================================

const CustomerForm = ({
  value,
  onChange,
}: {
  value: { name: string; email: string; phone: string; city: string; notes: string };
  onChange: (v: typeof value) => void;
}) => {
  const upd = (k: keyof typeof value) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">Your details</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required>
          <input
            value={value.name}
            onChange={upd("name")}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Jane Doe"
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            value={value.email}
            onChange={upd("email")}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="jane@example.com"
          />
        </Field>
        <Field label="Phone" required>
          <input
            value={value.phone}
            onChange={upd("phone")}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="+91 90000 00000"
          />
        </Field>
        <Field label="City">
          <input
            value={value.city}
            onChange={upd("city")}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Order notes (optional)">
            <textarea
              value={value.notes}
              onChange={upd("notes")}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Delivery instructions, preferred slot, etc."
            />
          </Field>
        </div>
      </div>
    </div>
  );
};

const Field = ({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium text-slate-700">
      {label}
      {required && <span className="ml-0.5 text-red-600">*</span>}
    </span>
    {children}
  </label>
);

const ProductCard = ({
  product,
  onAdd,
}: {
  product: CatalogProduct;
  onAdd: (v: Variant) => void;
}) => (
  <div className="rounded border border-slate-200 p-3">
    <div className="flex items-baseline justify-between">
      <div>
        <div className="font-semibold">{product.name}</div>
        <div className="text-xs text-slate-500">
          {product.sku} · {product.category}
        </div>
      </div>
    </div>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {product.variants.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onAdd(v)}
          className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm hover:border-blue-400 hover:bg-blue-50"
        >
          <div>
            <div className="font-medium">{v.sku}</div>
            <div className="text-xs text-slate-500">
              {[v.size, v.color, v.grade].filter(Boolean).join(" · ") ||
                v.uom ||
                "—"}{" "}
              · {v.stockOnHand} in stock
            </div>
          </div>
          <div className="text-sm font-semibold tnum">{inr(v.price)}</div>
        </button>
      ))}
    </div>
  </div>
);

const CartPanel = ({
  cart,
  subTotal,
  tax,
  cgstTotal,
  sgstTotal,
  total,
  busy,
  error,
  onQty,
  onRemove,
  onPlace,
}: {
  cart: CartLine[];
  subTotal: number;
  tax: number;
  cgstTotal: number;
  sgstTotal: number;
  total: number;
  busy: boolean;
  error: string | null;
  onQty: (variantId: string, qty: number) => void;
  onRemove: (variantId: string) => void;
  onPlace: () => void;
}) => (
  <aside className="sticky top-6 self-start rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <h2 className="mb-3 text-base font-semibold">Cart</h2>
    {cart.length === 0 ? (
      <div className="text-sm text-slate-500">
        Click any variant on the left to add it.
      </div>
    ) : (
      <div className="space-y-2">
        {cart.map((l) => (
          <div
            key={l.variantId ?? l.productId}
            className="rounded border border-slate-200 p-2 text-sm"
          >
            <div className="flex items-baseline justify-between">
              <div className="font-medium">{l.variantSku ?? l.productSku}</div>
              <button
                type="button"
                onClick={() => onRemove(l.variantId ?? l.productId)}
                className="text-xs text-red-600 hover:underline"
              >
                remove
              </button>
            </div>
            <div className="mt-1 text-xs text-slate-500">{l.productName}</div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onQty(l.variantId ?? l.productId, l.qty - 1)
                  }
                  className="h-6 w-6 rounded border border-slate-300 text-sm"
                >
                  −
                </button>
                <span className="w-6 text-center tnum">{l.qty}</span>
                <button
                  type="button"
                  onClick={() =>
                    onQty(l.variantId ?? l.productId, l.qty + 1)
                  }
                  className="h-6 w-6 rounded border border-slate-300 text-sm"
                  disabled={l.qty >= l.available}
                >
                  +
                </button>
                <span className="text-xs text-slate-400">
                  / {l.available} avail
                </span>
              </div>
              <div className="font-semibold tnum">
                {inr(l.qty * l.rate)}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
    <dl className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
      <Row label="Subtotal (excl. GST)" value={inr(subTotal)} />
      <Row label="CGST" value={inr(cgstTotal)} />
      <Row label="SGST" value={inr(sgstTotal)} />
      <Row label="Total" value={inr(total)} bold />
    </dl>
    {error && (
      <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-800">
        {error}
      </div>
    )}
    <button
      type="button"
      onClick={onPlace}
      disabled={busy || cart.length === 0}
      className="mt-4 w-full rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      {busy ? "Placing order…" : "Place prepaid order"}
    </button>
    <p className="mt-2 text-center text-[11px] text-slate-400">
      Mock payment - nothing is charged.
    </p>
  </aside>
);

const Row = ({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) => (
  <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
    <dt>{label}</dt>
    <dd className="tnum">{value}</dd>
  </div>
);

const SuccessCard = ({
  order,
  onAnother,
}: {
  order: OrderResult;
  onAnother: () => void;
}) => {
  const pickListLine =
    "error" in order.pickList
      ? `Pick list: failed (${order.pickList.error.code}) - re-issue from the desktop`
      : `Pick list drafted: ${order.pickList.pickListNo}`;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
      <div className="mb-3 flex items-center gap-2 text-emerald-800">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <h2 className="text-lg font-semibold">Order placed</h2>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <DocRow
          label="Customer"
          value={`${order.customer.name} (${order.customer.code})`}
        />
        <DocRow label="Account email" value={order.customerAccount.email} />
        <DocRow
          label="Sales order"
          value={order.salesOrder.soNo}
          link={
            order.salesOrder.shareToken
              ? `/share/sales-order/${order.salesOrder.shareToken}`
              : `/sales-orders`
          }
        />
        <DocRow
          label="Invoice"
          value={`${order.invoice.invoiceNo} (${order.invoice.status})`}
          link={
            order.invoice.shareToken
              ? `/share/invoice/${order.invoice.shareToken}`
              : `/billing`
          }
        />
        <DocRow label="Total paid" value={inr(order.invoice.amount)} />
        <DocRow label={pickListLine} value="" />
      </dl>
      <p className="mt-4 text-sm text-slate-700">
        Warehouse will see the pick list under{" "}
        <Link to="/picking" className="text-blue-700 hover:underline">
          /picking
        </Link>{" "}
        or via the mobile PWA at{" "}
        <Link to="/m/tasks" className="text-blue-700 hover:underline">
          /m/tasks
        </Link>
        . Once packed, a mock AWB is stamped on the packing slip.
      </p>
      <button
        type="button"
        onClick={onAnother}
        className="mt-4 rounded border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
      >
        Place another order
      </button>
    </div>
  );
};

const DocRow = ({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: string;
}) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
      {label}
    </dt>
    <dd className="font-mono text-sm">
      {link ? (
        <Link to={link} className="text-blue-700 hover:underline">
          {value || "open"}
        </Link>
      ) : (
        value
      )}
    </dd>
  </div>
);
