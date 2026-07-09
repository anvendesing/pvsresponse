// Channel-mapping manager (Settings → Channel mappings).
//
// Lets non-engineers maintain the per-channel translation table that
// connects upstream item codes (DTDC "I100") to our internal SKUs
// ("ML401"). Used by the imported-orders pipeline to resolve PDF rows
// into Product/Variant ids when committing a new SO.
//
// Two main affordances:
//   * CSV paste / file upload — bulk-import a fresh mapping list. The
//     backend returns counts and unresolved rows so the operator can
//     fix catalogue gaps before importing real orders.
//   * Inline edit / delete — for one-off corrections after the bulk
//     import.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, type ChannelMappingRow } from "@/lib/api";
import { backdropDismissProps } from "@/hooks/useBackdropDismiss";

interface FormState {
  channel: string;
  externalCode: string;
  internalSku: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  channel: "DTDC",
  externalCode: "",
  internalSku: "",
  notes: "",
};

// Permissive CSV parser. Accepts:
//   - Header row "ItemCode,BarCode" (case insensitive) OR no header
//   - Quoted or unquoted values
//   - CRLF / LF line endings
//   - Optional 3rd column for notes
const parseCsv = (text: string): { externalCode: string; internalSku: string; notes?: string }[] => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const splitRow = (line: string): string[] =>
    line
      .split(",")
      .map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
  const first = splitRow(lines[0]).map((c) => c.toLowerCase());
  const hasHeader =
    first.includes("itemcode") ||
    first.includes("externalcode") ||
    first.includes("external_code") ||
    first.includes("barcode") ||
    first.includes("internalsku") ||
    first.includes("sku");
  const startIdx = hasHeader ? 1 : 0;
  const rows: { externalCode: string; internalSku: string; notes?: string }[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = splitRow(lines[i]);
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    rows.push({
      externalCode: parts[0],
      internalSku: parts[1],
      notes: parts[2] || undefined,
    });
  }
  return rows;
};

export const ChannelMappingManager = () => {
  const [rows, setRows] = useState<ChannelMappingRow[]>([]);
  const [channels, setChannels] = useState<{ channel: string; count: number }[]>([]);
  const [loading, setLoading] = useState(apiEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<string>("");
  const [showOnlyUnresolved, setShowOnlyUnresolved] = useState(false);
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelMappingRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [importOpen, setImportOpen] = useState(false);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const closeImport = useCallback(() => setImportOpen(false), []);

  const [importChannel, setImportChannel] = useState("DTDC");
  const [importText, setImportText] = useState("");
  const [importReplace, setImportReplace] = useState(false);
  const [importResult, setImportResult] = useState<{
    total: number;
    created: number;
    updated: number;
    skipped: number;
    unresolved: { externalCode: string; internalSku: string }[];
  } | null>(null);

  const load = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    try {
      const [list, chs] = await Promise.all([
        api.channelMappings({
          channel: activeChannel || undefined,
          q: search.trim() || undefined,
          onlyUnresolved: showOnlyUnresolved,
        }),
        api.channelMappingChannels(),
      ]);
      setRows(list);
      setChannels(chs);
      if (!activeChannel && chs.length > 0) {
        // Don't auto-select; the "All channels" view is more useful as
        // the default, but we keep the chip list handy.
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [activeChannel, showOnlyUnresolved]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [search]);

  const counts = useMemo(() => {
    const unresolved = rows.filter((r) => !r.resolved).length;
    return { total: rows.length, unresolved };
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, channel: activeChannel || importChannel || "DTDC" });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (r: ChannelMappingRow) => {
    setEditing(r);
    setForm({
      channel: r.channel,
      externalCode: r.externalCode,
      internalSku: r.internalSku,
      notes: r.notes ?? "",
    });
    setError(null);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.channel.trim() || !form.externalCode.trim() || !form.internalSku.trim()) {
      setError("Channel, external code, and internal SKU are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        channel: form.channel.trim(),
        externalCode: form.externalCode.trim(),
        internalSku: form.internalSku.trim(),
        notes: form.notes.trim() || null,
      };
      if (editing) {
        await api.updateChannelMapping(editing.id, payload);
        setBanner(`Updated ${payload.externalCode} → ${payload.internalSku}.`);
      } else {
        await api.createChannelMapping(payload);
        setBanner(`Added ${payload.externalCode} → ${payload.internalSku}.`);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: ChannelMappingRow) => {
    if (!confirm(`Delete mapping ${r.externalCode} → ${r.internalSku}?`)) return;
    setBusy(true);
    try {
      await api.deleteChannelMapping(r.id);
      setBanner(`Deleted ${r.externalCode}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    setImportText(text);
  };

  const runImport = async () => {
    const parsed = parseCsv(importText);
    if (parsed.length === 0) {
      setError("No rows parsed from CSV — expected two columns: ItemCode,BarCode");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.importChannelMappings({
        channel: importChannel.trim() || "DTDC",
        replace: importReplace,
        rows: parsed,
      });
      setImportResult(result);
      setBanner(
        `Imported ${result.created} new + ${result.updated} updated mappings for ${result.channel}.`
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Channel mappings"
      subtitle="Translate upstream item codes into our catalog. The right column may be an internal SKU or a barcode — the resolver tries both."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<Upload size={14} />}
            onClick={() => {
              setImportResult(null);
              setImportOpen(true);
            }}
          >
            Import CSV
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={openCreate}
          >
            Add mapping
          </Button>
        </div>
      }
    >
      {banner && (
        <div className="mb-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-caption text-success">
          {banner}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          type="button"
          onClick={() => setActiveChannel("")}
        >
          <Chip tone={activeChannel === "" ? "primary" : "neutral"}>
            All channels ({channels.reduce((s, c) => s + c.count, 0)})
          </Chip>
        </button>
        {channels.map((c) => (
          <button key={c.channel} type="button" onClick={() => setActiveChannel(c.channel)}>
            <Chip tone={activeChannel === c.channel ? "primary" : "neutral"}>
              {c.channel} ({c.count})
            </Chip>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-caption text-ink-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyUnresolved}
              onChange={(e) => setShowOnlyUnresolved(e.target.checked)}
            />
            Only unresolved
            {counts.unresolved > 0 && (
              <Chip tone="warning" size="sm">{counts.unresolved}</Chip>
            )}
          </label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code or SKU…"
            className="w-48"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-ink-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-caption text-ink-muted">
          No mappings yet. Click "Import CSV" to bulk-load them, or "Add mapping" for one-offs.
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-body-sm">
            <thead className="bg-canvas text-caption text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Channel</th>
                <th className="text-left px-3 py-2 font-medium">External code</th>
                <th className="text-left px-3 py-2 font-medium">Internal SKU / barcode</th>
                <th className="text-left px-3 py-2 font-medium">Product</th>
                <th className="text-left px-3 py-2 font-medium">Notes</th>
                <th className="text-right px-3 py-2 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-canvas/50">
                  <td className="px-3 py-1.5">
                    <Chip tone="neutral" size="sm">{r.channel}</Chip>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-caption">{r.externalCode}</td>
                  <td className="px-3 py-1.5 font-mono text-caption font-semibold">
                    {r.internalSku}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.resolved ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 size={12} />
                        <span className="truncate max-w-xs">{r.productName ?? "—"}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <AlertCircle size={12} />
                        Unresolved
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-caption text-ink-muted truncate max-w-xs">
                    {r.notes ?? ""}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-canvas text-ink-muted hover:text-primary"
                        title="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => remove(r)}
                        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-canvas text-ink-muted hover:text-danger"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / edit modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          {...backdropDismissProps(closeModal)}
        >
          <div
            className="bg-surface rounded-lg shadow-xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-body font-semibold">
                {editing ? "Edit mapping" : "Add channel mapping"}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-ink-muted hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {error && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger">
                  {error}
                </div>
              )}
              <div>
                <label className="text-caption text-ink-muted">Channel</label>
                <Input
                  value={form.channel}
                  onChange={(e) => setForm({ ...form, channel: e.target.value })}
                  placeholder="e.g. DTDC"
                />
              </div>
              <div>
                <label className="text-caption text-ink-muted">External code (from PDF)</label>
                <Input
                  value={form.externalCode}
                  onChange={(e) => setForm({ ...form, externalCode: e.target.value })}
                  placeholder="I100"
                />
              </div>
              <div>
                <label className="text-caption text-ink-muted">
                  Internal SKU or barcode (our catalog)
                </label>
                <Input
                  value={form.internalSku}
                  onChange={(e) => setForm({ ...form, internalSku: e.target.value })}
                  placeholder="ML401 or SM976"
                />
                <div className="text-[10px] text-ink-muted mt-1">
                  Resolver tries ProductVariant.sku → barcode, then Product.sku → barcode.
                </div>
              </div>
              <div>
                <label className="text-caption text-ink-muted">Notes (optional)</label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={save} disabled={busy}>
                {busy ? "Saving…" : editing ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* CSV import modal */}
      {importOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          {...backdropDismissProps(closeImport)}
        >
          <div
            className="bg-surface rounded-lg shadow-xl w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-body font-semibold">Import channel mappings (CSV)</h3>
              <button onClick={() => setImportOpen(false)} className="text-ink-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {error && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-caption text-ink-muted">Channel</label>
                  <Input
                    value={importChannel}
                    onChange={(e) => setImportChannel(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-caption">
                    <input
                      type="checkbox"
                      checked={importReplace}
                      onChange={(e) => setImportReplace(e.target.checked)}
                    />
                    Replace all existing rows for this channel
                  </label>
                </div>
              </div>
              <div>
                <label className="text-caption text-ink-muted">
                  CSV file <span className="text-ink-muted">(or paste below)</span>
                </label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onImportFile(f);
                  }}
                  className="block w-full text-caption mt-1"
                />
              </div>
              <div>
                <label className="text-caption text-ink-muted">
                  CSV body — header row optional, 2 columns:{" "}
                  <code className="bg-canvas px-1">ItemCode,BarCode</code>
                </label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={10}
                  className="w-full mt-1 font-mono text-caption border border-border rounded-md p-2"
                  placeholder="ItemCode,BarCode&#10;I100,ML401&#10;I103,ML402"
                />
              </div>
              {importResult && (
                <div className="rounded-md border border-border bg-canvas/50 p-3 space-y-2">
                  <div className="text-caption">
                    Total <b>{importResult.total}</b> · Created{" "}
                    <b className="text-success">{importResult.created}</b> · Updated{" "}
                    <b className="text-primary">{importResult.updated}</b> · Skipped{" "}
                    <b className="text-ink-muted">{importResult.skipped}</b>
                  </div>
                  {importResult.unresolved.length > 0 && (
                    <div>
                      <div className="text-caption text-warning flex items-center gap-1">
                        <AlertCircle size={12} />
                        {importResult.unresolved.length} unresolved SKUs (mapping saved but
                        catalog has no matching Product/Variant):
                      </div>
                      <div className="mt-1 max-h-32 overflow-auto text-caption font-mono text-ink-muted">
                        {importResult.unresolved.map((u, i) => (
                          <div key={i}>
                            {u.externalCode} → {u.internalSku}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={runImport}
                disabled={busy || !importText.trim()}
              >
                {busy ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
