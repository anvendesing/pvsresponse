import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  MapPin,
  Package,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { CorrectOutputForm } from "@/components/manufacturing/CorrectOutputForm";
import { LogOutputForm } from "@/components/manufacturing/LogOutputForm";
import type { MoInventoryTrail } from "@/lib/api";
import type { Bom, ProductionOrder } from "@/data/types";
import { num } from "@/lib/format";
import { isMoClosed } from "@/lib/mo-utils";

const locLabel = (whCode: string, whKind: string, binPath: string) =>
  `${whCode} (${whKind}) · ${binPath}`;

interface Props {
  order: ProductionOrder;
  bom: Pick<Bom, "outputQty" | "byproducts"> | null;
  trail: MoInventoryTrail | null;
  loading: boolean;
  onRefreshTrail: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  /** Keep correction form visible for repeated edits (unified MO page). */
  alwaysShowCorrection?: boolean;
}

export const MoConsumptionTab = ({
  order,
  bom,
  trail,
  loading,
  onRefreshTrail,
  onSaved,
  alwaysShowCorrection = false,
}: Props) => {
  const [showCorrect, setShowCorrect] = useState(alwaysShowCorrection);
  const closed = isMoClosed(order.status);
  const hasLogged =
    order.actualQty > 0 || order.scrapQty > 0 || order.reworkQty > 0;
  const correctionVisible = alwaysShowCorrection || showCorrect;

  return (
  <div className="space-y-4">
    <LogOutputForm
      order={order}
      bom={bom}
      alreadyLogged={trail?.byproductsReleased}
      onSaved={onSaved}
    />

    {!closed && (hasLogged || alwaysShowCorrection) && (
      correctionVisible ? (
        <div className="space-y-2">
          {!alwaysShowCorrection && (
            <button
              type="button"
              onClick={() => setShowCorrect(false)}
              className="flex items-center gap-1 text-caption text-ink-muted hover:text-ink ml-auto"
            >
              <ChevronDown size={14} className="rotate-180" />
              Hide correction
            </button>
          )}
          <CorrectOutputForm
            order={order}
            onSaved={async (msg) => {
              await onSaved(msg);
              if (!alwaysShowCorrection) setShowCorrect(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCorrect(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-caption text-ink-muted hover:text-ink hover:border-primary/30 hover:bg-canvas transition-colors"
        >
          <RotateCcw size={13} />
          <span>
            Logged wrong totals?{" "}
            <span className="text-primary font-medium">Correct output</span>
          </span>
        </button>
      )
    )}

    <Card
      title="Inventory trail"
      subtitle="Bin-level consumption and finished goods posted for this MO"
      actions={
        <Button size="sm" variant="outline" onClick={onRefreshTrail} disabled={loading}>
          Refresh
        </Button>
      }
      noPadding
    >
      {loading && !trail ? (
        <div className="px-4 py-8 text-center text-body-sm text-ink-muted">
          Loading inventory trail…
        </div>
      ) : !trail ? (
        <div className="px-4 py-8 text-center text-body-sm text-ink-muted">No data loaded.</div>
      ) : !trail.hasActivity ? (
        <div className="px-4 py-8 text-body-sm text-ink-muted text-center">
          <MapPin size={16} className="inline mr-1.5 -mt-0.5" />
          No bin movements yet. Issue materials on the <strong>Materials</strong> tab, then log
          output above.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {trail.finishedGood.variantSku && (
            <div className="px-4 py-2.5 bg-primary/5 text-caption text-ink">
              Producing variant:{" "}
              <span className="font-mono font-semibold">{trail.finishedGood.variantSku}</span>
            </div>
          )}

          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
            <div className="p-4">
              <div className="flex items-center gap-2 text-body-sm font-semibold mb-3">
                <ArrowDownToLine size={16} className="text-warning shrink-0" />
                Materials consumed
              </div>
              {trail.materialsConsumed.length === 0 ? (
                <p className="text-caption text-ink-muted">Not issued yet.</p>
              ) : (
                <ul className="space-y-3">
                  {trail.materialsConsumed.map((m) => (
                    <li
                      key={`${m.productId}-${m.variantId ?? "p"}-${m.binPath}`}
                      className="text-body-sm"
                    >
                      <span className="font-mono text-caption text-ink-muted">
                        {m.variantSku ?? m.sku}
                      </span>{" "}
                      <span className="font-semibold">{m.name}</span>
                      <div className="text-caption text-ink-muted mt-0.5 flex items-start gap-1">
                        <MapPin size={12} className="mt-0.5 shrink-0" />
                        {locLabel(m.warehouseCode, m.warehouseKind, m.binPath)}
                      </div>
                      <div className="text-caption tnum text-ink-muted">
                        −{num(m.qty)}
                        {m.variantUom ? ` ${m.variantUom}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-4">
              <div className="flex items-center gap-2 text-body-sm font-semibold mb-3">
                <ArrowUpFromLine size={16} className="text-success shrink-0" />
                Finished goods posted
              </div>
              {trail.finishedGoodsPosted.length === 0 ? (
                <p className="text-caption text-ink-muted">Not posted yet — complete the MO.</p>
              ) : (
                <ul className="space-y-3">
                  {trail.finishedGoodsPosted.map((f) => (
                    <li key={`${f.variantId ?? "p"}-${f.binPath}`} className="text-body-sm">
                      <span className="font-semibold">{f.name}</span>{" "}
                      <span className="font-mono text-caption text-ink-muted">
                        ({f.variantSku ?? f.sku})
                      </span>
                      <div className="text-caption text-primary mt-0.5 flex items-start gap-1 font-medium">
                        <MapPin size={12} className="mt-0.5 shrink-0" />
                        {locLabel(f.warehouseCode, f.warehouseKind, f.binPath)}
                      </div>
                      <div className="text-caption tnum text-ink-muted">
                        +{num(f.qty)} {f.variantUom ?? trail.finishedGood.uom}
                      </div>
                      <Link
                        to={`/inventory?productId=${encodeURIComponent(f.productId)}${f.variantId ? `&variantId=${encodeURIComponent(f.variantId)}` : ""}`}
                        className="text-caption text-primary hover:underline mt-0.5 inline-block"
                      >
                        View in Inventory →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {trail.byproductsReleased.length > 0 && (
            <div className="px-4 py-3 border-t border-border">
              <div className="flex items-center gap-2 text-body-sm font-semibold mb-2">
                <Package size={16} className="text-primary shrink-0" />
                By-products released
              </div>
              <ul className="space-y-2 md:grid md:grid-cols-2 md:gap-3">
                {trail.byproductsReleased.map((bp) => (
                  <li key={`${bp.productId}-${bp.binPath}`} className="text-body-sm">
                    <span className="font-mono text-caption">{bp.variantSku ?? bp.sku}</span>{" "}
                    <span className="font-semibold">{bp.name}</span>
                    <div className="text-caption tnum text-ink-muted">+{num(bp.qty)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  </div>
  );
};
