// Customer master: list with search + active/inactive filter, modal editor
// for create/update, and a soft-delete that preserves history when there
// are linked quotes / sales orders / invoices.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useMemo, useRef, useState, useEffect } from "react";
import { AlertTriangle, BookOpen, DollarSign, Filter, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import { useApi } from "@/hooks/useApi";
import {
  api,
  type CustomerInput,
  type CustomerRow,
  type CustomerStatement,
  type InvoiceSeriesOption,
  type PriceListRow,
} from "@/lib/api";
import { inr, arBalanceInr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { formatCustomerSummary, validatePincode } from "@/lib/customerAddress";
import { PINCODE_PLACE_HINT, pincodeFieldUpdate } from "@/lib/pincodeLookup";
import { RecordPaymentModal } from "@/components/customers/RecordPaymentModal";

type ActiveFilter = "all" | "active" | "inactive";

const ACTIVE_FILTERS: { id: ActiveFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
];

export const Customers = () => {
  const [q, setQ] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<CustomerRow | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<CustomerRow | null>(null);

  // Always fetch including inactive — we filter client-side so the operator
  // can flip between Active / Inactive / All without re-fetching.
  const live = useApi(() => api.customers({ includeInactive: true }), []);
  const livePriceLists = useApi<PriceListRow[]>(() => api.priceLists(), []);
  const liveInvoiceSeries = useApi<InvoiceSeriesOption[]>(() => api.listInvoiceSeries(), []);

  const customers = live.data ?? [];
  const priceLists = livePriceLists.data ?? [];
  const invoiceSeries = liveInvoiceSeries.data ?? [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return customers.filter((c) => {
      if (activeFilter === "active" && c.active === false) return false;
      if (activeFilter === "inactive" && c.active !== false) return false;
      if (!term) return true;
      return (
        c.name.toLowerCase().includes(term) ||
        c.code.toLowerCase().includes(term) ||
        (c.gst ?? "").toLowerCase().includes(term) ||
        (c.city ?? "").toLowerCase().includes(term) ||
        (c.pincode ?? "").toLowerCase().includes(term) ||
        (c.addressLine ?? "").toLowerCase().includes(term) ||
        (c.contact ?? "").toLowerCase().includes(term)
      );
    });
  }, [customers, q, activeFilter]);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (row: CustomerRow) => {
    setEditing(row);
    setEditorOpen(true);
  };

  const onSaved = (saved: CustomerRow, mode: "create" | "edit") => {
    setBanner(
      mode === "create"
        ? `Created ${saved.code} · ${saved.name}.`
        : `Updated ${saved.code} · ${saved.name}.`
    );
    void live.refetch();
  };

  const onDeleted = (resp: { softDeleted: boolean; message?: string }, name: string) => {
    setBanner(
      resp.softDeleted
        ? `${name} marked inactive (history preserved).`
        : `${name} deleted.`
    );
    void live.refetch();
  };

  const cols: Column<CustomerRow>[] = [
    {
      key: "code",
      header: "Code",
      width: "110px",
      cell: (r) => (
        <span className="font-mono text-caption font-semibold text-primary">{r.code}</span>
      ),
      sortable: true,
      sortValue: (r) => r.code,
    },
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <div>
          <div className="font-semibold text-ink">{r.name}</div>
          <div className="text-caption text-ink-muted">
            {[formatCustomerSummary(r), r.contact].filter(Boolean).join(" · ") || "—"}
            {!r.pincode && (
              <span className="ml-1 text-warning font-semibold">· no pincode</span>
            )}
          </div>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.name,
    },
    {
      key: "gst",
      header: "GSTIN",
      width: "180px",
      cell: (r) => (
        <span className="font-mono text-caption">{r.gst || "—"}</span>
      ),
    },
    {
      key: "priceList",
      header: "Price list",
      width: "180px",
      cell: (r) =>
        r.priceList ? (
          <div>
            <div className="text-body-sm font-semibold">{r.priceList.code}</div>
            <div className="text-caption text-ink-muted">{r.priceList.name}</div>
          </div>
        ) : (
          <span className="text-caption text-ink-muted">Default</span>
        ),
    },
    {
      key: "creditLimit",
      header: "Credit limit",
      align: "right",
      width: "140px",
      cell: (r) => (
        <span className={cn("tnum", (r.creditLimit ?? 0) === 0 && "text-warning")}>
          {(r.creditLimit ?? 0) === 0 ? "Cash only" : inr(r.creditLimit ?? 0)}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.creditLimit ?? 0,
    },
    {
      key: "openBalance",
      header: "Open AR",
      align: "right",
      width: "130px",
      cell: (r) => {
        const ob = r.openBalance ?? 0;
        const limit = r.creditLimit ?? 0;
        const pct = limit > 0 ? Math.min(100, (ob / limit) * 100) : 0;
        return (
          <div className="space-y-0.5">
            <span className={cn("tnum text-body-sm font-semibold", ob > 0 ? "text-warning" : "text-ink-muted")}>
              {ob > 0 ? inr(ob) : "—"}
            </span>
            {limit > 0 && ob > 0 && (
              <div className="w-full h-1 rounded-full bg-border overflow-hidden">
                <div
                  className={cn("h-1 rounded-full", pct >= 90 ? "bg-error" : pct >= 60 ? "bg-warning" : "bg-success")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      },
      sortable: true,
      sortValue: (r) => r.openBalance ?? 0,
    },
    {
      key: "availableCredit",
      header: "Available credit",
      align: "right",
      width: "140px",
      cell: (r) => {
        if ((r.creditLimit ?? 0) === 0) return <span className="text-caption text-ink-muted">—</span>;
        const avail = r.availableCredit ?? 0;
        return (
          <span className={cn("tnum text-body-sm font-semibold", avail <= 0 ? "text-error" : "text-success")}>
            {avail <= 0 ? "Limit reached" : inr(avail)}
          </span>
        );
      },
    },
    {
      key: "history",
      header: "Sales activity",
      width: "140px",
      cell: (r) => {
        const c = r._count;
        if (!c) return <span className="text-caption text-ink-muted">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {c.quotes > 0 && (
              <Chip size="sm" tone="neutral">{c.quotes}Q</Chip>
            )}
            {c.salesOrders > 0 && (
              <Chip size="sm" tone="primary">{c.salesOrders} SO</Chip>
            )}
            {c.invoices > 0 && (
              <Chip size="sm" tone="success">{c.invoices} inv</Chip>
            )}
            {c.quotes + c.salesOrders + c.invoices === 0 && (
              <span className="text-caption text-ink-muted">No history</span>
            )}
          </div>
        );
      },
    },
    {
      key: "active",
      header: "Status",
      width: "100px",
      cell: (r) => (
        <Chip tone={r.active === false ? "neutral" : "success"} size="sm">
          {r.active === false ? "Inactive" : "Active"}
        </Chip>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      width: "120px",
      align: "right",
      className: "sticky right-0 bg-surface shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]",
      cell: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={(e) => { e.stopPropagation(); setStatementCustomer(r); }}
            className="h-7 px-2 grid place-items-center rounded-md text-ink-muted hover:bg-canvas hover:text-primary"
            title="Payment history (AR statement)"
          >
            <BookOpen size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setPaymentTarget(r); }}
            className="h-7 px-2 grid place-items-center rounded-md text-ink-muted hover:bg-canvas hover:text-success"
            title="Record payment"
          >
            <DollarSign size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            className="h-7 px-2 grid place-items-center rounded-md text-ink-muted hover:bg-canvas hover:text-primary"
            title="Edit customer"
          >
            <Pencil size={14} />
          </button>
        </div>
      ),
    },
  ];

  const initialLoading = live.loading || livePriceLists.loading;
  const initialError = live.error ?? livePriceLists.error;

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Customers</h2>
            <Chip tone="neutral">{filtered.length} of {customers.length}</Chip>
          </>
        }
        right={
          <>
            <Button variant="outline" size="sm" icon={<Filter size={14} />}>
              Filters
            </Button>
            <Button size="sm" icon={<Plus size={14} />} onClick={openCreate}>
              New customer
            </Button>
          </>
        }
      />

      <div className="px-4 py-2 bg-surface border-b border-border flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          iconLeft={<Search size={14} />}
          placeholder="Search by name, code, GSTIN, city, pincode, address…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="!h-8 max-w-xs"
        />
        <div className="flex items-center gap-1 ml-2">
          {ACTIVE_FILTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveFilter(s.id)}
              className={cn(
                "h-7 px-3 rounded-md text-caption font-semibold transition-colors capitalize",
                activeFilter === s.id
                  ? "bg-primary text-white"
                  : "bg-canvas text-ink-muted hover:text-primary"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-caption text-ink-muted hidden sm:inline">
          Scroll right for Actions ·{" "}
          <BookOpen size={12} className="inline -mt-0.5" /> statement ·{" "}
          <DollarSign size={12} className="inline -mt-0.5" /> record payment
        </span>
        <span className="ml-auto text-caption text-ink-muted sm:hidden">
          {filtered.length} customer{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {banner && (
        <div className="px-4 py-2 bg-primary-50 border-b border-primary/20 text-ink text-body-sm flex items-center gap-2">
          <span>{banner}</span>
          <button
            onClick={() => setBanner(null)}
            className="ml-auto text-ink-muted hover:text-ink text-caption"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto bg-surface">
        {initialLoading || initialError || filtered.length === 0 ? (
          <EmptyState
            loading={initialLoading}
            error={initialError}
            empty={!initialLoading && !initialError && filtered.length === 0}
            emptyTitle={
              customers.length === 0
                ? "No customers yet"
                : "No customers match the filters"
            }
            emptyDescription={
              customers.length === 0
                ? "Click 'New customer' to add your first one."
                : "Try a different search or change the active filter."
            }
            onRetry={() => {
              live.refetch();
              livePriceLists.refetch();
            }}
          />
        ) : (
          <DataTable
            rows={filtered}
            columns={cols}
            rowKey={(r) => r.id}
            onRowClick={(r) => openEdit(r)}
          />
        )}
      </div>

      {editorOpen && (
        <CustomerEditor
          customer={editing}
          priceLists={priceLists}
          invoiceSeries={invoiceSeries}
          onClose={() => setEditorOpen(false)}
          onSaved={(saved, mode) => {
            setEditorOpen(false);
            onSaved(saved, mode);
          }}
          onDeleted={(resp, name) => {
            setEditorOpen(false);
            onDeleted(resp, name);
          }}
        />
      )}

      {paymentTarget && (
        <RecordPaymentModal
          customer={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={() => {
            setBanner(`Payment recorded for ${paymentTarget.name}.`);
            setPaymentTarget(null);
            void live.refetch();
          }}
        />
      )}

      {statementCustomer && (
        <CustomerStatementPanel
          customer={statementCustomer}
          onClose={() => setStatementCustomer(null)}
          onRecordPayment={() => {
            setStatementCustomer(null);
            setPaymentTarget(statementCustomer);
          }}
        />
      )}
    </div>
  );
};

// ============================================================ Editor modal ===

const CustomerEditor = ({
  customer,
  priceLists,
  invoiceSeries,
  onClose,
  onSaved,
  onDeleted,
}: {
  customer: CustomerRow | null;
  priceLists: PriceListRow[];
  invoiceSeries: InvoiceSeriesOption[];
  onClose: () => void;
  onSaved: (saved: CustomerRow, mode: "create" | "edit") => void;
  onDeleted: (
    resp: { softDeleted: boolean; message?: string },
    name: string
  ) => void;
}) => {
  const isEdit = !!customer;
  const [code, setCode] = useState(customer?.code ?? "");
  const [name, setName] = useState(customer?.name ?? "");
  const [gst, setGst] = useState(customer?.gst ?? "");
  const [addressLine, setAddressLine] = useState(customer?.addressLine ?? customer?.city ?? "");
  const [city, setCity] = useState(customer?.city ?? "");
  const [district, setDistrict] = useState(customer?.district ?? "");
  const [state, setState] = useState(customer?.state ?? "");
  const [pincode, setPincode] = useState(customer?.pincode ?? "");
  const [previewDistanceKm, setPreviewDistanceKm] = useState<number | null>(
    customer?.distanceKm ?? null
  );
  const [previewDispatchPin, setPreviewDispatchPin] = useState<string | null>(
    customer?.dispatchPincode ?? null
  );
  const [contact, setContact] = useState(customer?.contact ?? "");
  const [creditLimit, setCreditLimit] = useState<number>(customer?.creditLimit ?? 0);
  const [priceListId, setPriceListId] = useState<string>(customer?.priceListId ?? "");
  const [documentSeriesId, setDocumentSeriesId] = useState<string>(
    customer?.documentSeriesId ?? ""
  );
  const [active, setActive] = useState<boolean>(customer?.active !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastAutofillPinRef = useRef(customer?.pincode?.replace(/\D/g, "").slice(0, 6) ?? "");

  useEffect(() => {
    if (isEdit || priceLists.length === 0) return;
    const retail = priceLists.find((p) => p.code === "RETAIL");
    const dealer = priceLists.find((p) => p.code === "DEALER");
    const trimmed = code.trim();
    const isSystemCode = !trimmed || /^CUST-\d+$/i.test(trimmed);
    const nextId = isSystemCode ? retail?.id : dealer?.id;
    if (nextId) setPriceListId(nextId);
  }, [code, isEdit, priceLists]);

  const pincodeError = validatePincode(pincode);
  const canSave =
    name.trim().length > 0 &&
    addressLine.trim().length >= 3 &&
    city.trim().length >= 2 &&
    !pincodeError &&
    !busy;

  const onPincodeChange = (raw: string) => {
    const base = { pincode, city, district, state };
    const { next, lastAutofillPin } = pincodeFieldUpdate(base, raw, lastAutofillPinRef.current);
    lastAutofillPinRef.current = lastAutofillPin;
    setPincode(next.pincode);
    if (next.city !== city) setCity(next.city);
    if (next.district !== district) setDistrict(next.district);
    if (next.state !== state) setState(next.state);
    if (next.pincode.length < 6) {
      setPreviewDistanceKm(null);
      setPreviewDispatchPin(null);
    }
  };

  useEffect(() => {
    const pin = pincode.replace(/\D/g, "").slice(0, 6);
    if (!/^[1-9]\d{5}$/.test(pin)) return;

    const timer = window.setTimeout(() => {
      void api
        .pincodeLookup(pin)
        .then((place) => {
          setPreviewDistanceKm(place.distanceKm);
          setPreviewDispatchPin(place.dispatchPincode);
        })
        .catch(() => {
          setPreviewDistanceKm(null);
          setPreviewDispatchPin(null);
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [pincode]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: CustomerInput = {
        name: name.trim(),
        code: code.trim() || undefined,
        gst: gst.trim() || null,
        addressLine: addressLine.trim(),
        city: city.trim(),
        district: district.trim() || null,
        state: state.trim() || null,
        pincode: pincode.trim(),
        contact: contact.trim() || null,
        creditLimit: Number.isFinite(creditLimit) ? Math.max(0, creditLimit) : 0,
        priceListId: priceListId || null,
        documentSeriesId: documentSeriesId || null,
        active,
      };
      if (isEdit && customer) {
        const updated = await api.updateCustomer(customer.id, payload);
        onSaved(updated, "edit");
      } else {
        const created = await api.createCustomer(payload);
        onSaved(created, "create");
      }
    } catch (e) {
      setError((e as Error).message ?? "Save failed.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!customer) return;
    const linked =
      (customer._count?.quotes ?? 0) +
      (customer._count?.salesOrders ?? 0) +
      (customer._count?.invoices ?? 0);
    const msg =
      linked > 0
        ? `Mark "${customer.name}" as INACTIVE? It has ${linked} linked transaction(s) which will be preserved.`
        : `Delete "${customer.name}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.deleteCustomer(customer.id);
      onDeleted(r, customer.name);
    } catch (e) {
      setError((e as Error).message ?? "Delete failed.");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      {...backdropDismissProps(onClose)}
    >
      <div
        className="bg-surface w-full max-w-2xl rounded-lg elevation-3 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              {isEdit ? "Edit customer" : "New customer"}
            </div>
            <div className="text-h3 font-bold flex items-center gap-2">
              {isEdit ? customer?.name : "New customer"}
              {isEdit && (
                <Chip
                  tone={customer?.active === false ? "neutral" : "success"}
                  size="sm"
                >
                  {customer?.active === false ? "Inactive" : "Active"}
                </Chip>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="bg-danger-soft border-b border-danger text-danger px-4 py-2 text-body-sm">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Code"
              hint={isEdit ? undefined : "Leave blank to auto-generate (CUST-####)"}
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CUST-1001"
                disabled={busy}
              />
            </Field>
            <Field label="Name *">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Industries"
                disabled={busy}
              />
            </Field>
            <Field label="GSTIN">
              <Input
                value={gst}
                onChange={(e) => setGst(e.target.value.toUpperCase())}
                placeholder="29ABCDE1234F2Z5"
                disabled={busy}
              />
            </Field>
            <Field label="Contact">
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="+91 98765 43210 / name@example.com"
                disabled={busy}
              />
            </Field>
            <Field label="Address line *" className="col-span-2">
              <Input
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                placeholder="Door no, street, area, landmark"
                disabled={busy}
              />
            </Field>
            <Field label="Pincode *" hint={PINCODE_PLACE_HINT} className="col-span-2">
              <Input
                value={pincode}
                onChange={(e) => onPincodeChange(e.target.value)}
                placeholder="524004"
                disabled={busy}
              />
              {pincode && pincodeError && (
                <div className="text-caption text-danger mt-1">{pincodeError}</div>
              )}
              {previewDistanceKm != null && (
                <div className="text-caption text-ink-muted mt-1">
                  Approx.{" "}
                  <span className="font-semibold tnum">{Math.round(previewDistanceKm)} km</span>{" "}
                  from dispatch
                  {previewDispatchPin ? ` (${previewDispatchPin})` : ""}
                  {" · saved when you create/update this customer"}
                </div>
              )}
            </Field>
            <Field label="City / town *">
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Nellore"
                disabled={busy}
              />
            </Field>
            <Field label="District">
              <Input
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="Nellore"
                disabled={busy}
              />
            </Field>
            <Field label="State">
              <Input
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="Andhra Pradesh"
                disabled={busy}
              />
            </Field>
            <Field label="Credit limit (₹)" hint="0 = cash only">
              <Input
                type="number"
                min={0}
                value={creditLimit}
                onChange={(e) => setCreditLimit(Number(e.target.value) || 0)}
                disabled={busy}
              />
            </Field>
            <Field label="Price list" className="col-span-2">
              <select
                className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm"
                value={priceListId}
                onChange={(e) => setPriceListId(e.target.value)}
                disabled={busy}
              >
                <option value="">Default (product selling price)</option>
                {priceLists
                  .filter((p) => p.active !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                      {typeof p.multiplier === "number"
                        ? ` (×${p.multiplier})`
                        : ""}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label="Invoice numbering scheme"
              hint="Optional — overrides channel default for this customer's invoices"
              className="col-span-2"
            >
              <select
                className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm"
                value={documentSeriesId}
                onChange={(e) => setDocumentSeriesId(e.target.value)}
                disabled={busy}
              >
                <option value="">Channel / company default</option>
                {invoiceSeries.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                    {s.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {isEdit && (
              <Field label="Status" className="col-span-2">
                <label className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    disabled={busy}
                  />
                  Active (uncheck to hide from selectors without losing history)
                </label>
              </Field>
            )}
          </div>

          {isEdit && customer && (
            <div className="bg-canvas border border-border rounded-md p-3">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                History
              </div>
              <div className="text-body-sm">
                {customer._count
                  ? `${customer._count.quotes} quote${customer._count.quotes === 1 ? "" : "s"}, ${customer._count.salesOrders} sales order${customer._count.salesOrders === 1 ? "" : "s"}, ${customer._count.invoices} invoice${customer._count.invoices === 1 ? "" : "s"}.`
                  : "—"}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 flex items-center gap-2 bg-canvas">
          {isEdit && (
            <Button
              variant="outline"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={remove}
              disabled={busy}
              className="border-danger text-danger hover:bg-danger-soft"
            >
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSave}>
            {busy ? "Saving…" : isEdit ? "Save" : "Create customer"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ======================================================= Statement panel ===

const CustomerStatementPanel = ({
  customer,
  onClose,
  onRecordPayment,
}: {
  customer: CustomerRow;
  onClose: () => void;
  onRecordPayment: () => void;
}) => {
  const stmtApi = useApi(
    () => api.customerStatement(customer.id),
    [customer.id]
  );
  const stmt: CustomerStatement | null = stmtApi.data ?? null;
  const [closingId, setClosingId] = useState<string | null>(null);
  const [backOrderingId, setBackOrderingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  // Closing a partially-fulfilled SO accepts the warehouse shortfall:
  // the backend bumps qtyCancelled on every line, drops the SO's
  // soCommitment to 0, and the customer's open balance shrinks to
  // match the actual issued invoice (not the original SO total).
  const closePartialSo = async (soId: string) => {
    setClosingId(soId);
    setActionError(null);
    setActionInfo(null);
    try {
      await api.closeSalesOrder(soId);
      setActionInfo("SO closed. Open balance now matches the issued invoice.");
      await stmtApi.refetch?.();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setClosingId(null);
    }
  };

  // Back-order: spin off the un-invoiced remainder into a fresh SO
  // (status='confirmed', new pick/pack/invoice flow) and close the
  // parent. Useful when the customer still wants the missing units
  // and the warehouse will fulfil them in a later batch.
  const backOrderPartialSo = async (soId: string) => {
    setBackOrderingId(soId);
    setActionError(null);
    setActionInfo(null);
    try {
      const r = await api.backOrderSalesOrder(soId);
      setActionInfo(
        `Back-order ${r.backOrder.soNo} created (${inr(r.backOrder.total)}). Parent ${r.parent.soNo} closed.`
      );
      await stmtApi.refetch?.();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBackOrderingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 flex justify-end"
      {...backdropDismissProps(onClose)}
    >
      <div className="bg-surface h-full w-full max-w-3xl flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3 shrink-0">
          <BookOpen size={18} className="text-primary" />
          <div>
            <p className="font-bold text-ink">{customer.name}</p>
            <p className="text-caption text-ink-muted">{customer.code} · AR Statement</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<DollarSign size={13} />}
              onClick={onRecordPayment}
            >
              Record Payment
            </Button>
            <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-md text-ink-muted hover:text-ink hover:bg-canvas">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Summary KPI row */}
        {stmt && (() => {
          const closing = stmt.entries[stmt.entries.length - 1]?.balance ?? 0;
          const closingFmt = arBalanceInr(closing);
          return (
          <div className="border-b border-border shrink-0">
            <div className="grid grid-cols-3 gap-0">
            {[
              {
                label: "Open AR (owed)",
                value: stmt.customer.openBalance > 0 ? inr(stmt.customer.openBalance) : "—",
                highlight: stmt.customer.openBalance > 0,
              },
              {
                label: "Credit Limit",
                value: (customer.creditLimit ?? 0) === 0 ? "Cash only" : inr(customer.creditLimit ?? 0),
                highlight: false,
              },
              {
                label: "Available Credit",
                value:
                  stmt.customer.availableCredit === null
                    ? "—"
                    : stmt.customer.availableCredit <= 0
                    ? "Limit reached"
                    : inr(stmt.customer.availableCredit),
                highlight: false,
              },
            ].map((k) => (
              <div key={k.label} className="px-4 py-3 border-r last:border-r-0 border-border">
                <p className="text-caption text-ink-muted">{k.label}</p>
                <p className={cn("text-h3 font-bold tnum whitespace-nowrap", k.highlight ? "text-warning" : "text-ink")}>
                  {k.value}
                </p>
              </div>
            ))}
            </div>
            <div className="px-4 py-2 bg-canvas border-t border-border flex items-center justify-between gap-3 text-body-sm">
              <span className="text-ink-muted">
                Ledger closing balance
                <span className="hidden sm:inline"> · Dr = owes · Cr = advance</span>
              </span>
              <span
                className={cn(
                  "font-bold tnum whitespace-nowrap",
                  closingFmt.tone === "owed" && "text-warning",
                  closingFmt.tone === "advance" && "text-success",
                  closingFmt.tone === "zero" && "text-ink-muted"
                )}
              >
                {closingFmt.text}
              </span>
            </div>
            {closingFmt.tone === "advance" && (
              <div className="px-4 py-2 bg-success/5 border-t border-success/20 text-caption text-ink">
                Payments exceed invoiced amount — customer has{" "}
                <strong>{inr(Math.abs(closing))}</strong> advance on account.
                This is not an error; large prepayments show as <strong>Cr</strong> balances.
              </div>
            )}
          </div>
          );
        })()}

        {/* Open-balance breakdown banner. The KPI strip's Open Balance
            includes any un-invoiced commitment from partially-fulfilled
            SOs (warehouse shortfalls / back-orders), which is why it
            can be higher than the AR ledger's running balance. The
            banner exposes the breakdown plus two one-tap actions per
            SO: create a back-order SO (keep the commitment alive on a
            fresh order) or close (accept the shortfall and write off
            the remainder). */}
        {stmt &&
          stmt.partiallyInvoicedSOs &&
          stmt.partiallyInvoicedSOs.length > 0 &&
          (stmt.breakdown?.openSOCommitment ?? 0) > 0 && (
            <div className="border-b border-warning/30 bg-warning-soft px-5 py-3 shrink-0">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
                <div className="flex-1 text-body-sm">
                  <div className="font-semibold text-ink">
                    Open balance includes {inr(stmt.breakdown!.openSOCommitment)}{" "}
                    of un-invoiced commitment
                  </div>
                  <div className="text-caption text-ink-muted mt-0.5">
                    Invoice remainder {inr(stmt.breakdown!.invoiceRemainder)}
                    {stmt.breakdown!.unallocatedAdvance > 0 &&
                      ` · advance on file ${inr(stmt.breakdown!.unallocatedAdvance)}`}
                    . The SO{stmt.partiallyInvoicedSOs.length === 1 ? "" : "s"} below {stmt.partiallyInvoicedSOs.length === 1 ? "is" : "are"} keeping the
                    remainder on the customer's books. Either spin off
                    a back-order to fulfil it later, or close to accept
                    the shortfall.
                  </div>
                  <div className="mt-2 space-y-2">
                    {stmt.partiallyInvoicedSOs.map((s) => {
                      const busy = closingId === s.id || backOrderingId === s.id;
                      return (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 text-body-sm flex-wrap"
                        >
                          <span className="font-mono font-semibold text-primary">
                            {s.soNo}
                          </span>
                          <span className="text-ink-muted">
                            {Math.round(s.invoicedFraction * 100)}% invoiced ·
                            ~{inr(s.remainingCommitment)} remaining
                            {s.remainingQty > 0
                              ? ` (${s.remainingQty} unit${s.remainingQty === 1 ? "" : "s"})`
                              : ""}
                          </span>
                          <div className="flex-1" />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => backOrderPartialSo(s.id)}
                            title="Spin the un-invoiced remainder off into a brand-new SO and close this one. Use when the customer still wants the missing units."
                          >
                            {backOrderingId === s.id
                              ? "Creating…"
                              : "Create back-order SO"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => closePartialSo(s.id)}
                            title="Cancel the un-invoiced remainder and close this SO. Open balance drops to the issued invoice total."
                          >
                            {closingId === s.id
                              ? "Closing…"
                              : "Close (accept shortfall)"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  {actionInfo && (
                    <div className="mt-2 text-caption text-success">
                      {actionInfo}
                    </div>
                  )}
                  {actionError && (
                    <div className="mt-2 text-caption text-danger">
                      {actionError}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        {/* Ledger table */}
        <div className="flex-1 overflow-y-auto">
          {stmtApi.loading && (
            <div className="p-6 text-body-sm text-ink-muted">Loading statement…</div>
          )}
          {stmtApi.error && (
            <div className="p-6 text-body-sm text-error">{stmtApi.error.message}</div>
          )}
          {stmt && stmt.entries.length === 0 && (
            <div className="p-6 text-body-sm text-ink-muted">No transactions yet.</div>
          )}
          {stmt && stmt.entries.length > 0 && (
            <table className="w-full text-body-sm">
              <thead>
                <tr className="bg-canvas border-b border-border sticky top-0">
                  <th className="px-3 py-2 text-left text-caption font-semibold text-ink-muted">Date</th>
                  <th className="px-3 py-2 text-left text-caption font-semibold text-ink-muted">Ref</th>
                  <th className="px-3 py-2 text-left text-caption font-semibold text-ink-muted">Description</th>
                  <th className="px-3 py-2 text-right text-caption font-semibold text-ink-muted whitespace-nowrap">Debit</th>
                  <th className="px-3 py-2 text-right text-caption font-semibold text-ink-muted whitespace-nowrap">Credit</th>
                  <th className="px-3 py-2 text-right text-caption font-semibold text-ink-muted whitespace-nowrap min-w-[9rem]">Balance</th>
                </tr>
              </thead>
              <tbody>
                {stmt.entries.map((e, i) => (
                  <tr key={i} className={cn("border-b border-border", e.type === "payment" ? "bg-primary-50" : "")}>
                    <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
                      {new Date(e.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-caption font-semibold text-primary">{e.ref}</span>
                    </td>
                    <td className="px-3 py-2 text-ink max-w-[200px] truncate" title={e.description}>
                      {e.description}
                      {e.status && e.type === "invoice" && (
                        <span className={cn(
                          "ml-1 text-caption px-1.5 py-0.5 rounded-full",
                          e.status === "paid" ? "bg-success/10 text-success" :
                          e.status === "partial" ? "bg-warning/10 text-warning" :
                          "bg-border text-ink-muted"
                        )}>
                          {e.status}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-error font-medium whitespace-nowrap">
                      {e.debit > 0 ? inr(e.debit) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-success font-medium whitespace-nowrap">
                      {e.credit > 0 ? inr(e.credit) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tnum font-semibold whitespace-nowrap min-w-[9rem]">
                      {(() => {
                        const b = arBalanceInr(e.balance);
                        return (
                          <span
                            className={cn(
                              b.tone === "owed" && "text-warning",
                              b.tone === "advance" && "text-success",
                              b.tone === "zero" && "text-ink-muted"
                            )}
                          >
                            {b.text}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-canvas border-t-2 border-border font-semibold">
                  <td colSpan={5} className="px-3 py-2 text-right text-body-sm">Closing balance</td>
                  <td className="px-3 py-2 text-right tnum text-ink whitespace-nowrap min-w-[9rem]">
                    {arBalanceInr(stmt.entries[stmt.entries.length - 1]?.balance ?? 0).text}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================== Field helper

const Field = ({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={className}>
    <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
      {label}
    </div>
    {children}
    {hint && <div className="text-caption text-ink-muted mt-1">{hint}</div>}
  </div>
);
