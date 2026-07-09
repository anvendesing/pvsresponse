import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, PackageCheck } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import type { MoRequirements } from "@/lib/api";
import type { ProductionOrder } from "@/data/types";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { isMoClosed } from "@/lib/mo-utils";

interface Props {
  order: ProductionOrder;
  requirements: MoRequirements | null;
  loading: boolean;
  busy: string | null;
  onRefresh: () => void;
  onRelease: () => void;
  onIssue: () => void;
}

export const MoMaterialsTab = ({
  order,
  requirements,
  loading,
  busy,
  onRefresh,
  onRelease,
  onIssue,
}: Props) => {
  const navigate = useNavigate();
  const closed = isMoClosed(order.status);

  const canRelease = order.status === "planned";
  const canIssue = !closed && !(requirements?.allFullyIssued ?? false);

  const topShort =
    requirements?.lines
      .filter((l) => l.shortage > 0 && l.stillNeeded > 0)
      .sort((a, b) => b.shortage - a.shortage)[0] ?? null;

  return (
    <div className="space-y-4">
      {!closed && (
        <Card title="Material actions" subtitle="Release to line and issue consumption from bins">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<ArrowRightLeft size={14} />}
              onClick={onRelease}
              disabled={busy === "release" || !canRelease}
              title={
                canRelease
                  ? "Check stock at line and create replenishment transfers if short"
                  : `Release only while MO is planned (current: ${order.status})`
              }
            >
              {busy === "release" ? "Releasing…" : "Release MO"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<PackageCheck size={14} />}
              onClick={onIssue}
              disabled={busy === "issue" || !canIssue}
              title={
                requirements?.allFullyIssued
                  ? "All materials already issued"
                  : "Consume BOM materials from bins"
              }
            >
              {busy === "issue" ? "Issuing…" : "Issue materials"}
            </Button>
          </div>

          {requirements?.anyShortage && !requirements.allFullyIssued && (
            <div className="mt-4 px-3 py-2.5 rounded-lg bg-warning-soft border border-warning/30 flex items-start gap-2 text-body-sm text-[#8a6300]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Shortages detected — use <strong>Release</strong> to replenish the line, or add
                stock below.
              </span>
            </div>
          )}
        </Card>
      )}

      <Card
        title={closed ? "Materials snapshot" : "Material requirements"}
        subtitle={
          closed
            ? `MO ${order.status} · historical BOM consumption`
            : requirements
              ? `${requirements.lines.length} component(s) · remaining ${num(requirements.plannedFor)} units`
              : "Loading…"
        }
        actions={
          <div className="flex items-center gap-2">
            {!closed && requirements?.allFullyIssued && (
              <Chip tone="success" icon={<PackageCheck size={12} />}>
                Issued
              </Chip>
            )}
            {!closed && requirements?.anyShortage && !requirements?.allFullyIssued && (
              <Chip tone="danger" icon={<AlertTriangle size={12} />}>
                Shortages
              </Chip>
            )}
            {!closed && (
              <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
                Refresh
              </Button>
            )}
          </div>
        }
        noPadding
      >
        {!closed && requirements?.anyShortage && !requirements.allFullyIssued && topShort && (
          <div className="px-4 py-2.5 bg-warning-soft border-b border-warning/30 flex flex-wrap items-center gap-3 text-body-sm">
            <AlertTriangle size={14} className="shrink-0 text-warning" />
            <span className="flex-1 min-w-[200px]">
              Short on <strong>{topShort.sku}</strong> — need +{num(topShort.shortage, 2)}{" "}
              {topShort.uom}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigate(
                  `/inventory?adjust=1&from=mfg&productId=${encodeURIComponent(topShort.productId)}&delta=${topShort.shortage}`
                )
              }
            >
              Add stock
            </Button>
          </div>
        )}

        <div className="grid grid-cols-12 grid-header-cell text-caption">
          <div className="col-span-2">SKU</div>
          <div className="col-span-3">Component</div>
          <div className="col-span-1 text-right">Req</div>
          <div className="col-span-1 text-right">Issued</div>
          <div className="col-span-1 text-right">{closed ? "—" : "To issue"}</div>
          <div className="col-span-2 text-right">{closed ? "Final" : "At line / bins"}</div>
          <div className="col-span-1 text-right">{closed ? "Var" : "Short"}</div>
          <div className="col-span-1" />
        </div>

        {loading && !requirements ? (
          <div className="px-4 py-8 text-center text-body-sm text-ink-muted">
            Computing requirements…
          </div>
        ) : !requirements || requirements.lines.length === 0 ? (
          <div className="px-4 py-8 text-center text-body-sm text-ink-muted">
            {requirements ? "No leaf components on this BOM." : "No data loaded."}
          </div>
        ) : (
          requirements.lines.map((l) => (
            <div
              key={l.productId}
              className={cn(
                "grid grid-cols-12 grid-cell items-center",
                l.shortage > 0 && "bg-danger-soft/40"
              )}
            >
              <div className="col-span-2 font-mono text-caption">{l.sku}</div>
              <div className="col-span-3 font-semibold truncate">{l.name}</div>
              <div className="col-span-1 text-right tnum">{num(l.required, 2)}</div>
              <div className="col-span-1 text-right tnum text-ink-muted">{num(l.issued, 2)}</div>
              <div
                className={cn(
                  "col-span-1 text-right tnum",
                  l.stillNeeded > 0 ? "text-warning font-semibold" : "text-success"
                )}
              >
                {num(l.stillNeeded, 2)}
              </div>
              <div className="col-span-2 text-right tnum text-ink-muted">
                {num(l.onHand, 2)} {l.uom}
              </div>
              <div
                className={cn(
                  "col-span-1 text-right tnum font-semibold",
                  l.shortage > 0 ? "text-danger" : "text-success"
                )}
              >
                {l.shortage > 0 ? `−${num(l.shortage, 2)}` : "✓"}
              </div>
              <div className="col-span-1 flex justify-end">
                {!closed && l.shortage > 0 && l.stillNeeded > 0 && (
                  <Link
                    to={`/inventory?adjust=1&from=mfg&productId=${encodeURIComponent(l.productId)}&delta=${l.shortage}`}
                    className="text-caption text-primary hover:underline"
                  >
                    Add
                  </Link>
                )}
              </div>
            </div>
          ))
        )}

        {!closed && requirements?.allFullyIssued && (
          <div className="px-4 py-3 bg-success-soft border-t border-success/30 text-body-sm text-success flex items-start gap-2">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>
              All materials issued. Continue on <strong>Work orders</strong> and{" "}
              <strong>Consumption &amp; output</strong>.
            </span>
          </div>
        )}
      </Card>
    </div>
  );
};
