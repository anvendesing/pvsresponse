import { ChevronDown, ChevronRight, Package } from "lucide-react";
import { Chip, StatusDot } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import type { Bin } from "@/data/types";
import { num } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  binDisplayLabel,
  binFillPct,
  type ShelfGroup,
} from "@/components/warehouse/warehouse-layout-utils";

type RowEdit = { barcode: string; qty: string };

const occupancyTone = (pct: number): "success" | "warning" | "danger" | "neutral" => {
  if (pct === 0) return "neutral";
  if (pct < 60) return "success";
  if (pct < 90) return "warning";
  return "danger";
};

interface Props {
  group: ShelfGroup;
  expanded: boolean;
  bulkEdit: boolean;
  edits: Record<string, RowEdit>;
  onToggle: () => void;
  onEdit: (binId: string, patch: Partial<RowEdit>) => void;
}

export const ShelfMasonryCard = ({
  group,
  expanded,
  bulkEdit,
  edits,
  onToggle,
  onEdit,
}: Props) => {
  const tone = occupancyTone(group.avgOccupancyPct);

  return (
    <article
      className={cn(
        "break-inside-avoid mb-3 rounded-lg border bg-white overflow-hidden transition-shadow",
        expanded ? "border-primary shadow-md ring-1 ring-primary/20" : "border-border hover:border-primary/30"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-canvas/60 transition-colors"
      >
        <span className="mt-0.5 text-ink-muted shrink-0">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-body-sm font-bold text-primary truncate">
              {group.shelfLabel}
            </span>
            <Chip size="sm" tone={tone} icon={<StatusDot tone={tone} />}>
              {group.avgOccupancyPct}% full
            </Chip>
          </div>
          <div className="text-caption text-ink-muted mt-0.5">
            {group.zoneLabel} · {group.bins.length} bin{group.bins.length !== 1 ? "s" : ""}
          </div>
        </span>
        <div className="text-right shrink-0">
          <div className="text-body-sm font-bold tnum">{num(group.totalQty)}</div>
          <div className="text-[10px] text-ink-muted uppercase tracking-wide">units</div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-canvas/30 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2 text-caption text-ink-muted">
            <Package size={12} />
            {group.occupiedBins} occupied · tap row fields below to bulk-update stock
          </div>

          <div className="rounded-md border border-border bg-white overflow-hidden">
            <div
              className={cn(
                "grid text-[10px] uppercase tracking-wide text-ink-muted font-semibold bg-canvas border-b border-border",
                bulkEdit
                  ? "grid-cols-[3.5rem_1fr_4rem_5.5rem_4.5rem]"
                  : "grid-cols-[3.5rem_1fr_4rem]"
              )}
            >
              <div className="px-2 py-1.5">Bin</div>
              <div className="px-2 py-1.5">Stored</div>
              <div className="px-2 py-1.5 text-right">Qty</div>
              {bulkEdit && (
                <>
                  <div className="px-2 py-1.5">SKU scan</div>
                  <div className="px-2 py-1.5 text-right">New qty</div>
                </>
              )}
            </div>

            {group.bins.map((b) => (
              <BinRow
                key={b.id}
                bin={b}
                bulkEdit={bulkEdit}
                edit={edits[b.id] ?? { barcode: "", qty: "" }}
                onEdit={(patch) => onEdit(b.id, patch)}
              />
            ))}

            {group.bins.length === 0 && (
              <div className="px-3 py-4 text-center text-caption text-ink-muted">No bins on this shelf.</div>
            )}
          </div>
        </div>
      )}
    </article>
  );
};

const BinRow = ({
  bin,
  bulkEdit,
  edit,
  onEdit,
}: {
  bin: Bin;
  bulkEdit: boolean;
  edit: RowEdit;
  onEdit: (patch: Partial<RowEdit>) => void;
}) => {
  const pct = binFillPct(bin);
  const tone = occupancyTone(pct);
  const sku = bin.variantSku ?? bin.productSku;
  const hasStock = (bin.qty ?? 0) > 0;

  return (
    <div
      className={cn(
        "grid border-b border-border/60 last:border-b-0 text-body-sm items-center min-h-[2.75rem]",
        bulkEdit ? "grid-cols-[3.5rem_1fr_4rem_5.5rem_4.5rem]" : "grid-cols-[3.5rem_1fr_4rem]",
        hasStock ? "bg-success-soft/10" : ""
      )}
    >
      <div className="px-2 py-1.5 font-mono text-caption font-semibold">{binDisplayLabel(bin)}</div>
      <div className="px-2 py-1.5 min-w-0">
        {hasStock ? (
          <>
            <div className="font-medium truncate">{bin.productName ?? "—"}</div>
            {sku && (
              <div className="font-mono text-caption text-ink-muted truncate">
                {sku}
                {bin.variantUom ? ` · ${bin.variantUom}` : ""}
              </div>
            )}
            {bin.batch && (
              <div className="text-[10px] text-ink-muted font-mono">Batch {bin.batch}</div>
            )}
          </>
        ) : (
          <span className="text-caption text-ink-muted">Empty</span>
        )}
        <div className="mt-1 h-1 max-w-[120px] bg-canvas rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full",
              tone === "success" && "bg-success",
              tone === "warning" && "bg-warning",
              tone === "danger" && "bg-danger",
              tone === "neutral" && "bg-border"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="px-2 py-1.5 text-right font-bold tnum">{num(bin.qty ?? 0)}</div>
      {bulkEdit && (
        <>
          <div className="px-1 py-1">
            <Input
              size="sm"
              placeholder="Scan"
              value={edit.barcode}
              onChange={(e) => onEdit({ barcode: e.target.value })}
              aria-label={`Barcode ${binDisplayLabel(bin)}`}
            />
          </div>
          <div className="px-1 py-1">
            <Input
              size="sm"
              type="number"
              min={0}
              placeholder="—"
              value={edit.qty}
              onChange={(e) => onEdit({ qty: e.target.value })}
              aria-label={`Qty ${binDisplayLabel(bin)}`}
              className="text-right"
            />
          </div>
        </>
      )}
    </div>
  );
};
