import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ClipboardList,
  Factory,
  Package,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { dt, num } from "@/lib/format";

type OutputRow = { id: string; barcode: string; qty: string };
type MaterialRow = { id: string; barcode: string };

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const DailyProduction = () => {
  const logs = useApi(() => api.dailyProductionLogs({ limit: 30 }), []);

  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [outputs, setOutputs] = useState<OutputRow[]>([
    { id: newId(), barcode: "", qty: "1" },
  ]);
  const [materialInput, setMaterialInput] = useState("");
  const [outputBarcode, setOutputBarcode] = useState("");
  const [outputQty, setOutputQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof api.previewDailyProduction>
  > | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const outputPayload = useMemo(
    () =>
      outputs
        .filter((o) => o.barcode.trim() && Number(o.qty) > 0)
        .map((o) => ({ barcode: o.barcode.trim(), qty: Number(o.qty) })),
    [outputs]
  );

  const materialPayload = useMemo(
    () => materials.filter((m) => m.barcode.trim()).map((m) => ({ barcode: m.barcode.trim() })),
    [materials]
  );

  const runPreview = useCallback(async () => {
    if (outputPayload.length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewError(null);
    try {
      const res = await api.previewDailyProduction({
        outputs: outputPayload,
        materialScans: materialPayload.length ? materialPayload : undefined,
      });
      setPreview(res);
    } catch (e) {
      setPreview(null);
      setPreviewError((e as Error).message);
    }
  }, [outputPayload, materialPayload]);

  useEffect(() => {
    const t = setTimeout(() => void runPreview(), 400);
    return () => clearTimeout(t);
  }, [runPreview]);

  const addMaterial = () => {
    const code = materialInput.trim();
    if (!code) return;
    setMaterials((prev) => [...prev, { id: newId(), barcode: code }]);
    setMaterialInput("");
  };

  const addOutput = () => {
    const code = outputBarcode.trim();
    const qty = Number(outputQty);
    if (!code || !Number.isFinite(qty) || qty <= 0) return;
    setOutputs((prev) => [...prev, { id: newId(), barcode: code, qty: String(qty) }]);
    setOutputBarcode("");
    setOutputQty("1");
  };

  const onPost = async () => {
    if (outputPayload.length === 0) {
      setPostError("Add at least one produced item with barcode and qty.");
      return;
    }
    setBusy(true);
    setPostError(null);
    setBanner(null);
    try {
      const res = await api.postDailyProduction({
        outputs: outputPayload,
        materialScans: materialPayload.length ? materialPayload : undefined,
        notes: notes.trim() || null,
        clientOpId: `dpl-${Date.now()}`,
      });
      setBanner(
        `Posted ${res.logNo} — ${res.postings.length} FG line(s) to stock room, ${res.consumptions.length} material issue(s).`
      );
      setMaterials([]);
      setOutputs([{ id: newId(), barcode: "", qty: "1" }]);
      setNotes("");
      setPreview(null);
      await logs.refetch();
    } catch (e) {
      setPostError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logRows = logs.data ?? [];

  type LogRow = (typeof logRows)[number];

  const logColumns: Column<LogRow>[] = [
    { key: "logNo", header: "Log #", cell: (r) => r.logNo },
    { key: "loggedAt", header: "When", cell: (r) => dt(r.loggedAt) },
    { key: "loggedBy", header: "By", cell: (r) => r.loggedBy },
    {
      key: "outputs",
      header: "Produced",
      cell: (r) =>
        r.outputs.map((o) => `${o.sku} × ${num(o.qty)}`).join(", ") || "—",
    },
    {
      key: "postings",
      header: "Stock room bins",
      cell: (r) =>
        r.postings
          .map((p) => `${p.warehouseCode} · ${p.binCode} (${num(p.qty)})`)
          .join("; ") || "—",
    },
  ];

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <Toolbar
        left={
          <div className="flex items-center gap-3">
            <Link
              to="/manufacturing"
              className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Manufacturing
            </Link>
            <h1 className="text-xl font-bold text-slate-900">Daily production log</h1>
          </div>
        }
        right={
          <Button onClick={() => void onPost()} disabled={busy || outputPayload.length === 0}>
            {busy ? "Posting…" : "Post to stock room"}
          </Button>
        }
      />

      <p className="text-sm text-slate-600 max-w-3xl">
        Log today&apos;s production without creating a manufacturing order. Scan material
        barcodes (optional), then add produced FG barcodes with quantities. BOM components
        are issued automatically and finished goods land in the stock room per putaway rules
        — no transfer order.
      </p>

      {banner && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {banner}
        </div>
      )}
      {postError && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {postError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Package className="h-5 w-5 text-slate-500" />
            <h2 className="font-semibold text-slate-900">1. Material barcodes</h2>
            <Chip tone="neutral">optional</Chip>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Scan raw material or source bin barcodes first. If omitted, components are issued
            FIFO from available stock.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Scan / type material or bin barcode"
              value={materialInput}
              onChange={(e) => setMaterialInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMaterial()}
            />
            <Button variant="secondary" onClick={addMaterial}>
              Add
            </Button>
          </div>
          {materials.length > 0 && (
            <ul className="mt-3 space-y-1">
              {materials.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="font-mono">{m.barcode}</span>
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() =>
                      setMaterials((prev) => prev.filter((x) => x.id !== m.id))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Factory className="h-5 w-5 text-slate-500" />
            <h2 className="font-semibold text-slate-900">2. Produced items</h2>
          </div>
          <div className="grid grid-cols-[1fr_100px_auto] gap-2">
            <Input
              placeholder="FG barcode / SKU"
              value={outputBarcode}
              onChange={(e) => setOutputBarcode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOutput()}
            />
            <Input
              type="number"
              min={1}
              placeholder="Qty"
              value={outputQty}
              onChange={(e) => setOutputQty(e.target.value)}
            />
            <Button variant="secondary" onClick={addOutput}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ul className="mt-3 space-y-2">
            {outputs.map((o) => (
              <li key={o.id} className="grid grid-cols-[1fr_100px_auto] gap-2">
                <Input
                  value={o.barcode}
                  onChange={(e) =>
                    setOutputs((prev) =>
                      prev.map((x) =>
                        x.id === o.id ? { ...x, barcode: e.target.value } : x
                      )
                    )
                  }
                  placeholder="Barcode"
                />
                <Input
                  type="number"
                  min={1}
                  value={o.qty}
                  onChange={(e) =>
                    setOutputs((prev) =>
                      prev.map((x) =>
                        x.id === o.id ? { ...x, qty: e.target.value } : x
                      )
                    )
                  }
                />
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-2 text-red-600"
                  onClick={() =>
                    setOutputs((prev) =>
                      prev.length > 1 ? prev.filter((x) => x.id !== o.id) : prev
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-slate-500" />
          <h2 className="font-semibold text-slate-900">BOM preview</h2>
        </div>
        {previewError && (
          <p className="text-sm text-red-600">{previewError}</p>
        )}
        {!previewError && !preview && (
          <p className="text-sm text-slate-500">Add produced items to see material requirements.</p>
        )}
        {preview && (
          <div className="space-y-4">
            {preview.totals.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Total materials to consume
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-slate-500">
                        <th className="py-2 pr-4">SKU</th>
                        <th className="py-2 pr-4">Required</th>
                        <th className="py-2">Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.totals.map((t) => (
                        <tr key={t.sku} className="border-b border-slate-100">
                          <td className="py-2 pr-4 font-mono">{t.sku}</td>
                          <td className="py-2 pr-4">
                            {num(t.required)} {t.uom}
                          </td>
                          <td className="py-2">
                            <span
                              className={
                                t.available < t.required
                                  ? "text-amber-700 font-medium"
                                  : "text-emerald-700"
                              }
                            >
                              {num(t.available)} {t.uom}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {preview.outputs.map((o) => (
              <div key={o.sku} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="font-medium text-slate-900">
                  {o.name} · {o.sku} × {num(o.qty)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
            Notes
          </label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Shift, line, batch reference…"
          />
        </div>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col p-4">
        <h2 className="mb-3 font-semibold text-slate-900">Recent logs</h2>
        {logs.loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <DataTable
            columns={logColumns}
            rows={logRows}
            rowKey={(r) => r.logNo}
            empty="No daily production logs yet."
          />
        )}
      </Card>
    </div>
  );
};
