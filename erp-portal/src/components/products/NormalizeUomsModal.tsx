// Bulk UoM normalization modal.
//
// One-shot maintenance tool: coerces every Product to a bulk UoM
// (kg / L / m) and every ProductVariant to "pc". Loads a server-side
// dry-run on mount and shows the planned changes before the operator
// hits Apply.
//
// Admin / supervisor only — both the route and the calling button are
// gated.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  Package,
  RefreshCw,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { api, type UomNormalizationResult } from "@/lib/api";

interface Props {
  onClose: () => void;
  onApplied: (msg: string) => void;
}

export const NormalizeUomsModal = ({ onClose, onApplied }: Props) => {
  const [plan, setPlan] = useState<UomNormalizationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "update" | "skip">("update");

  const loadPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.normalizeProductUoms(false);
      setPlan(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPlan();
  }, []);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.normalizeProductUoms(true);
      const pu = res.summary.products.willUpdate;
      const vu = res.summary.variants.willUpdate;
      onApplied(
        `Normalized UoMs: ${pu} product${pu === 1 ? "" : "s"} → bulk units, ${vu} variant${vu === 1 ? "" : "s"} → pc.`
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const productRows = useMemo(() => {
    if (!plan) return [];
    return plan.products.filter((p) =>
      filter === "all" ? true : p.action === filter
    );
  }, [plan, filter]);

  const variantRows = useMemo(() => {
    if (!plan) return [];
    return plan.variants.filter((v) =>
      filter === "all" ? true : filter === "skip" ? false : v.action === filter
    );
  }, [plan, filter]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[920px] max-w-[97vw] max-h-[92vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Wand2 size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Normalize product UoMs
              </div>
              <div className="text-body-sm">
                Parents in <strong>kg / L</strong>, variants in{" "}
                <strong>pc</strong>. Dry-run preview — apply to commit.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={14} />}
              onClick={loadPlan}
              disabled={loading || busy}
            >
              Reload
            </Button>
            <button
              onClick={onClose}
              className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="rounded-md border border-info bg-info-soft px-3 py-2 text-body-sm text-ink">
            Parent product UoMs are coerced to <strong>kg</strong> (weight),{" "}
            <strong>L</strong> (volume), or <strong>m</strong> (length); other
            categories are left alone. Every variant is set to <strong>pc</strong>{" "}
            (piece). <code>packSize</code> is preserved so variant→bulk
            conversions stay correct.
          </div>

          {/* Summary cards */}
          {plan && (
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-border rounded-md p-3">
                <div className="flex items-center gap-2 text-caption text-ink-muted uppercase font-semibold mb-2">
                  <Package size={12} /> Products
                </div>
                <div className="grid grid-cols-3 gap-2 text-body-sm">
                  <div>
                    <div className="text-h3 font-bold text-primary tnum">
                      {plan.summary.products.willUpdate}
                    </div>
                    <div className="text-caption text-ink-muted">to update</div>
                  </div>
                  <div>
                    <div className="text-h3 font-bold text-ink-muted tnum">
                      {plan.summary.products.unchanged}
                    </div>
                    <div className="text-caption text-ink-muted">unchanged</div>
                  </div>
                  <div>
                    <div className="text-h3 font-bold text-warning tnum">
                      {plan.summary.products.skipped}
                    </div>
                    <div className="text-caption text-ink-muted">need review</div>
                  </div>
                </div>
              </div>
              <div className="border border-border rounded-md p-3">
                <div className="flex items-center gap-2 text-caption text-ink-muted uppercase font-semibold mb-2">
                  <Layers size={12} /> Variants
                </div>
                <div className="grid grid-cols-3 gap-2 text-body-sm">
                  <div>
                    <div className="text-h3 font-bold text-primary tnum">
                      {plan.summary.variants.willUpdate}
                    </div>
                    <div className="text-caption text-ink-muted">to update</div>
                  </div>
                  <div>
                    <div className="text-h3 font-bold text-ink-muted tnum">
                      {plan.summary.variants.unchanged}
                    </div>
                    <div className="text-caption text-ink-muted">already pc</div>
                  </div>
                  <div>
                    <div className="text-h3 font-bold text-ink-muted tnum">
                      {plan.summary.variants.total}
                    </div>
                    <div className="text-caption text-ink-muted">total</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filter chips */}
          <div className="flex items-center gap-2">
            <span className="text-caption text-ink-muted uppercase font-semibold">
              Showing
            </span>
            {(
              [
                { id: "update", label: "To update" },
                { id: "skip", label: "Need review" },
                { id: "all", label: "All" },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`h-7 px-3 rounded-md text-caption font-semibold transition-colors ${
                  filter === f.id
                    ? "bg-primary text-white"
                    : "bg-canvas text-ink-muted hover:text-primary"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Products table */}
          <div className="border border-border rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-canvas border-b border-border text-caption text-ink-muted uppercase font-semibold flex items-center justify-between">
              <span>Products ({productRows.length})</span>
              {plan && plan.summary.products.skipped > 0 && filter !== "skip" && (
                <button
                  className="text-caption text-warning underline"
                  onClick={() => setFilter("skip")}
                >
                  {plan.summary.products.skipped} need review
                </button>
              )}
            </div>
            {loading ? (
              <div className="p-6 text-center text-body-sm text-ink-muted">
                Loading plan…
              </div>
            ) : productRows.length === 0 ? (
              <div className="p-6 text-center text-body-sm text-ink-muted">
                Nothing to show with this filter.
              </div>
            ) : (
              <div className="max-h-[260px] overflow-y-auto">
                <div className="grid grid-cols-12 grid-header-cell text-caption sticky top-0 bg-canvas">
                  <div className="col-span-3">SKU</div>
                  <div className="col-span-4">Name</div>
                  <div className="col-span-1">Type</div>
                  <div className="col-span-2">From → To</div>
                  <div className="col-span-2">Action</div>
                </div>
                {productRows.map((p) => (
                  <div
                    key={p.id}
                    className="grid grid-cols-12 grid-cell items-center !py-2 text-body-sm border-t border-border"
                  >
                    <div className="col-span-3 font-mono text-caption">{p.sku}</div>
                    <div className="col-span-4 truncate">{p.name}</div>
                    <div className="col-span-1 text-caption text-ink-muted">{p.type}</div>
                    <div className="col-span-2 tnum">
                      <span className="text-ink-muted">{p.currentUom || "—"}</span>{" "}
                      <span className="text-ink-muted">→</span>{" "}
                      <span className="font-semibold">{p.targetUom ?? "?"}</span>
                    </div>
                    <div className="col-span-2">
                      {p.action === "update" && (
                        <Chip size="sm" tone="primary">Will update</Chip>
                      )}
                      {p.action === "noop" && (
                        <Chip size="sm" tone="neutral">Unchanged</Chip>
                      )}
                      {p.action === "skip" && (
                        <span title={p.reason}>
                          <Chip size="sm" tone="warning">Skip</Chip>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Variants table */}
          <div className="border border-border rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-canvas border-b border-border text-caption text-ink-muted uppercase font-semibold">
              Variants ({variantRows.length})
            </div>
            {loading ? (
              <div className="p-6 text-center text-body-sm text-ink-muted">
                Loading plan…
              </div>
            ) : variantRows.length === 0 ? (
              <div className="p-6 text-center text-body-sm text-ink-muted">
                Nothing to show with this filter.
              </div>
            ) : (
              <div className="max-h-[260px] overflow-y-auto">
                <div className="grid grid-cols-12 grid-header-cell text-caption sticky top-0 bg-canvas">
                  <div className="col-span-3">Variant SKU</div>
                  <div className="col-span-3">Parent SKU</div>
                  <div className="col-span-3">From → To</div>
                  <div className="col-span-2">Status</div>
                  <div className="col-span-1">Active</div>
                </div>
                {variantRows.map((v) => (
                  <div
                    key={v.id}
                    className="grid grid-cols-12 grid-cell items-center !py-2 text-body-sm border-t border-border"
                  >
                    <div className="col-span-3 font-mono text-caption">{v.sku}</div>
                    <div className="col-span-3 font-mono text-caption text-ink-muted">
                      {v.productSku}
                    </div>
                    <div className="col-span-3 tnum">
                      <span className="text-ink-muted">
                        {v.currentUom || "(inherit)"}
                      </span>{" "}
                      <span className="text-ink-muted">→</span>{" "}
                      <span className="font-semibold">{v.targetUom}</span>
                    </div>
                    <div className="col-span-2">
                      {v.action === "update" ? (
                        <Chip size="sm" tone="primary">Will update</Chip>
                      ) : (
                        <Chip size="sm" tone="neutral">Unchanged</Chip>
                      )}
                    </div>
                    <div className="col-span-1 text-caption text-ink-muted">
                      {v.active ? "yes" : "no"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-between gap-2 bg-canvas">
          <div className="text-caption text-ink-muted self-center">
            {plan
              ? `${plan.summary.products.willUpdate + plan.summary.variants.willUpdate} record${
                  plan.summary.products.willUpdate +
                    plan.summary.variants.willUpdate ===
                  1
                    ? ""
                    : "s"
                } will change.`
              : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              icon={<CheckCircle2 size={14} />}
              onClick={() => setConfirmOpen(true)}
              disabled={
                busy ||
                loading ||
                !plan ||
                plan.summary.products.willUpdate +
                  plan.summary.variants.willUpdate ===
                  0
              }
            >
              {busy ? "Applying…" : "Apply changes"}
            </Button>
          </div>
        </div>

        {confirmOpen && plan && (
          <div className="absolute inset-0 z-[10] bg-ink/50 grid place-items-center">
            <div className="bg-surface w-[420px] max-w-[90vw] rounded-lg elevation-3 p-5 space-y-3">
              <div className="text-h3 font-semibold">Apply UoM normalization?</div>
              <div className="text-body-sm text-ink-muted">
                This will update{" "}
                <strong>{plan.summary.products.willUpdate} product(s)</strong>{" "}
                and{" "}
                <strong>{plan.summary.variants.willUpdate} variant(s)</strong>.
                Each change is recorded in the audit log and can be reviewed,
                but there is no automatic undo.
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  icon={<CheckCircle2 size={14} />}
                  onClick={() => {
                    setConfirmOpen(false);
                    void apply();
                  }}
                  disabled={busy}
                >
                  {busy ? "Applying…" : "Yes, apply"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
