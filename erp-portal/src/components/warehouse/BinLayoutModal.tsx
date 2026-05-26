// One modal that handles both single-bin add and bulk-rack create.
//
// Tab "Single bin": warehouse + zone/rack/shelf/bin/capacity. Used to
// add one extra bin to an existing shelf or to start a brand new
// zone/rack/shelf hierarchy.
//
// Tab "Whole rack": pick a warehouse + zone, name the rack, choose
// shelf labels (or "auto N shelves") and bins-per-shelf. The backend
// generates `${shelf}-01`, `${shelf}-02`, ... bin codes.
//
// Existing labels are surfaced as datalist suggestions so operators
// don't accidentally create "A1" and "A-1" side by side.

import { useEffect, useMemo, useState } from "react";
import { Boxes, Layers, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { Chip } from "@/components/common/Chip";
import { api, type WarehouseRow } from "@/lib/api";
import type { Bin } from "@/data/types";
import { cn } from "@/lib/cn";

interface Props {
  // All bins currently known to the UI; used for autocomplete and to
  // prefill from a "+ inside this node" affordance.
  allBins: Bin[];
  warehouses: WarehouseRow[];
  // Optional pre-fills - e.g. if the user clicked "+" on the Zone A
  // node, prefill warehouse and zone so they only type the rack/shelf.
  prefill?: {
    warehouseId?: string;
    zone?: string;
    rack?: string;
    shelf?: string;
  };
  initialMode?: "single" | "bulk";
  onClose: () => void;
  onCreated: (summary: string) => void;
}

const labelOk = /^[A-Za-z0-9-]{1,20}$/;

export const BinLayoutModal = ({
  allBins,
  warehouses,
  prefill,
  initialMode = "bulk",
  onClose,
  onCreated,
}: Props) => {
  const [mode, setMode] = useState<"single" | "bulk">(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------- Picker state -----------------------------------------
  // Default to first active warehouse if not prefilled.
  const initialWh =
    prefill?.warehouseId ??
    warehouses.find((w) => w.active)?.id ??
    warehouses[0]?.id ??
    "";
  const [warehouseId, setWarehouseId] = useState(initialWh);

  // Single-bin form
  const [zoneS, setZoneS] = useState(prefill?.zone ?? "A");
  const [rackS, setRackS] = useState(prefill?.rack ?? "");
  const [shelfS, setShelfS] = useState(prefill?.shelf ?? "");
  const [binS, setBinS] = useState("");
  const [capacityS, setCapacityS] = useState(100);

  // Bulk form
  const [zoneB, setZoneB] = useState(prefill?.zone ?? "A");
  const [rackB, setRackB] = useState(prefill?.rack ?? "");
  const [shelfCount, setShelfCount] = useState(4);
  const [binsPerShelf, setBinsPerShelf] = useState(5);
  const [capacityB, setCapacityB] = useState(100);

  // Reset zoneS/zoneB if the user changes warehouse and the current
  // zone string isn't sensible. (Keeping things simple - we don't
  // force values, just refresh the suggestion list.)
  useEffect(() => {
    if (!warehouseId && warehouses[0]) setWarehouseId(warehouses[0].id);
  }, [warehouseId, warehouses]);

  // Existing labels for autocomplete, scoped to the chosen warehouse.
  // We pull them from `allBins` (already loaded) instead of an extra
  // API round-trip.
  const selectedWh = warehouses.find((w) => w.id === warehouseId);
  const scopedBins = useMemo(
    () => allBins.filter((b) => b.warehouse === selectedWh?.code),
    [allBins, selectedWh]
  );
  const zones = useMemo(
    () => Array.from(new Set(scopedBins.map((b) => b.zone))).sort(),
    [scopedBins]
  );
  const racksInZone = (zone: string) =>
    Array.from(
      new Set(scopedBins.filter((b) => b.zone === zone).map((b) => b.rack))
    ).sort();
  const shelvesInRack = (zone: string, rack: string) =>
    Array.from(
      new Set(
        scopedBins
          .filter((b) => b.zone === zone && b.rack === rack)
          .map((b) => b.shelf)
      )
    ).sort();

  // -------- Submission ------------------------------------------
  const submitSingle = async () => {
    if (!warehouseId) return setError("Pick a warehouse first.");
    for (const [k, v] of Object.entries({ zone: zoneS, rack: rackS, shelf: shelfS, bin: binS })) {
      if (!labelOk.test(v)) {
        return setError(`${k} must be 1-20 chars (letters / numbers / hyphen).`);
      }
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createBin(warehouseId, {
        zone: zoneS,
        rack: rackS,
        shelf: shelfS,
        bin: binS,
        capacity: capacityS,
      });
      onCreated(`Bin ${created.zone}/${created.rack}/${created.shelf}/${created.bin} created.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const bulkPreview =
    shelfCount && binsPerShelf
      ? `${shelfCount} shelf × ${binsPerShelf} bins = ${shelfCount * binsPerShelf} bins`
      : "";

  const submitBulk = async () => {
    if (!warehouseId) return setError("Pick a warehouse first.");
    if (!labelOk.test(zoneB) || !labelOk.test(rackB)) {
      return setError("Zone and rack must be 1-20 chars (letters / numbers / hyphen).");
    }
    if (shelfCount < 1 || shelfCount > 100 || binsPerShelf < 1 || binsPerShelf > 200) {
      return setError("Shelf count 1-100, bins per shelf 1-200.");
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.bulkCreateBins(warehouseId, {
        zone: zoneB,
        rack: rackB,
        shelfCount,
        binsPerShelf,
        capacity: capacityB,
      });
      onCreated(
        `Created ${res.created} bins across ${res.shelves} shelves under ${selectedWh?.code} / ${res.zone} / ${res.rack}.`
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-xl rounded-lg elevation-3 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Boxes size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Bin layout
              </div>
              <div className="text-body-sm">
                Add bins, shelves and racks to your warehouse.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-3 border-b border-border flex gap-1">
          <ModeTab
            active={mode === "bulk"}
            onClick={() => setMode("bulk")}
            label="Whole rack"
            hint="N shelves × M bins"
          />
          <ModeTab
            active={mode === "single"}
            onClick={() => setMode("single")}
            label="Single bin"
            hint="One spot"
          />
        </div>

        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">
            {error}
          </div>
        )}

        <div className="p-4 space-y-3 overflow-y-auto">
          <Field label="Warehouse">
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              {warehouses
                .filter((w) => w.active)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.code}
                  </option>
                ))}
            </select>
          </Field>

          {mode === "bulk" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Zone" hint="Group of racks (e.g. A, B, COLD).">
                  <Input
                    list="zones"
                    placeholder="A"
                    value={zoneB}
                    onChange={(e) => setZoneB(e.target.value.toUpperCase())}
                  />
                </Field>
                <Field label="Rack" hint="New rack label (e.g. R5).">
                  <Input
                    placeholder="R5"
                    value={rackB}
                    onChange={(e) => setRackB(e.target.value.toUpperCase())}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Shelves">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={shelfCount}
                    onChange={(e) => setShelfCount(Number(e.target.value) || 1)}
                  />
                </Field>
                <Field label="Bins / shelf">
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={binsPerShelf}
                    onChange={(e) => setBinsPerShelf(Number(e.target.value) || 1)}
                  />
                </Field>
                <Field label="Capacity / bin">
                  <Input
                    type="number"
                    min={1}
                    value={capacityB}
                    onChange={(e) => setCapacityB(Number(e.target.value) || 100)}
                  />
                </Field>
              </div>
              <div className="border border-border rounded-md p-3 bg-canvas">
                <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                  Preview
                </div>
                {rackB && labelOk.test(rackB) ? (
                  <div className="text-body-sm">
                    Rack <strong>{rackB}</strong> on zone <strong>{zoneB}</strong>{" "}
                    will get{" "}
                    <strong>{bulkPreview}</strong>. Shelves auto-named{" "}
                    <span className="font-mono">
                      S1…S{shelfCount}
                    </span>
                    , bins auto-numbered{" "}
                    <span className="font-mono">01…{String(binsPerShelf).padStart(2, "0")}</span>.
                  </div>
                ) : (
                  <div className="text-body-sm text-ink-muted">
                    Enter a rack label to see the preview.
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Zone">
                  <Input
                    list="zones"
                    placeholder="A"
                    value={zoneS}
                    onChange={(e) => setZoneS(e.target.value.toUpperCase())}
                  />
                </Field>
                <Field label="Rack">
                  <Input
                    list="racks"
                    placeholder="R1"
                    value={rackS}
                    onChange={(e) => setRackS(e.target.value.toUpperCase())}
                  />
                </Field>
                <Field label="Shelf">
                  <Input
                    list="shelves"
                    placeholder="S1"
                    value={shelfS}
                    onChange={(e) => setShelfS(e.target.value.toUpperCase())}
                  />
                </Field>
                <Field label="Bin">
                  <Input
                    placeholder="01"
                    value={binS}
                    onChange={(e) => setBinS(e.target.value.toUpperCase())}
                  />
                </Field>
              </div>
              <Field label="Capacity">
                <Input
                  type="number"
                  min={1}
                  value={capacityS}
                  onChange={(e) => setCapacityS(Number(e.target.value) || 100)}
                />
              </Field>
            </>
          )}

          {/* Existing structure hint - quick-glance to keep labels consistent. */}
          {selectedWh && scopedBins.length > 0 && (
            <div className="border border-border rounded-md p-3 bg-canvas/50">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Existing in {selectedWh.code}
              </div>
              <div className="flex flex-wrap gap-1">
                {zones.map((z) => (
                  <Chip key={z} size="sm" tone="neutral">
                    <Layers size={10} className="mr-1" /> {z}{" "}
                    <span className="text-ink-muted ml-1">
                      · {racksInZone(z).length} rack
                      {racksInZone(z).length === 1 ? "" : "s"}
                    </span>
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {/* Datalists used for autocomplete */}
          <datalist id="zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          {mode === "single" && zoneS && (
            <datalist id="racks">
              {racksInZone(zoneS).map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          )}
          {mode === "single" && zoneS && rackS && (
            <datalist id="shelves">
              {shelvesInRack(zoneS, rackS).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={mode === "bulk" ? submitBulk : submitSingle}
            disabled={busy}
          >
            {busy ? "Saving…" : mode === "bulk" ? "Create rack" : "Create bin"}
          </Button>
        </div>
      </div>
    </div>
  );
};

const ModeTab = ({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "px-3 py-2 rounded-t-md border-b-2 transition-colors text-left",
      active
        ? "border-primary text-primary"
        : "border-transparent text-ink-muted hover:text-ink"
    )}
  >
    <div className="text-body-sm font-semibold">{label}</div>
    <div className="text-caption">{hint}</div>
  </button>
);

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div>
    <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
      {label}
    </div>
    {children}
    {hint && <div className="text-caption text-ink-muted mt-1">{hint}</div>}
  </div>
);
