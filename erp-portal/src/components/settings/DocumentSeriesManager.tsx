import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import {
  api,
  type DocumentSeriesInput,
  type DocumentSeriesRow,
} from "@/lib/api";

const CHANNELS = [
  { value: "", label: "None (manual / customer assignment)" },
  { value: "internal", label: "B2B / internal" },
  { value: "imported", label: "PDF import" },
  { value: "ecommerce", label: "Ecommerce" },
  { value: "pos", label: "POS / walk-in" },
] as const;

const RESET_PERIODS = [
  { value: "yearly", label: "Yearly" },
  { value: "fiscal", label: "Fiscal year" },
  { value: "monthly", label: "Monthly" },
  { value: "never", label: "Never" },
] as const;

const emptyDraft = (): DocumentSeriesInput => ({
  code: "",
  name: "",
  documentType: "invoice",
  prefix: "INV",
  pattern: "{PREFIX}-{YYYY}-{SEQ}",
  padWidth: 4,
  startNumber: 1,
  nextNumber: 1,
  resetPeriod: "yearly",
  channelSource: null,
  isDefault: false,
  active: true,
});

export const DocumentSeriesManager = () => {
  const [rows, setRows] = useState<DocumentSeriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DocumentSeriesInput | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DocumentSeriesInput | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.getDocumentSeries());
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveNew = async () => {
    if (!draft?.code.trim() || !draft.name.trim()) return;
    setBusy(true);
    try {
      await api.createDocumentSeries({
        ...draft,
        code: draft.code.trim().toUpperCase(),
        channelSource: draft.channelSource || null,
      });
      setDraft(null);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editId || !editDraft) return;
    setBusy(true);
    try {
      await api.updateDocumentSeries(editId, {
        ...editDraft,
        code: editDraft.code.trim().toUpperCase(),
        channelSource: editDraft.channelSource || null,
      });
      setEditId(null);
      setEditDraft(null);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: DocumentSeriesRow) => {
    if (!confirm(`Remove series "${r.code}"?`)) return;
    setBusy(true);
    try {
      const res = await api.deleteDocumentSeries(r.id);
      if (res.softDeleted) alert("Series has invoices — deactivated instead of deleted.");
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r: DocumentSeriesRow) => {
    setEditId(r.id);
    setEditDraft({
      code: r.code,
      name: r.name,
      documentType: "invoice",
      prefix: r.prefix,
      pattern: r.pattern,
      padWidth: r.padWidth,
      startNumber: r.startNumber,
      nextNumber: r.nextNumber,
      resetPeriod: r.resetPeriod as DocumentSeriesInput["resetPeriod"],
      channelSource: r.channelSource,
      isDefault: r.isDefault,
      active: r.active,
    });
    setDraft(null);
  };

  const renderForm = (
    value: DocumentSeriesInput,
    onChange: (v: DocumentSeriesInput) => void,
    onSave: () => void,
    onCancel: () => void
  ) => (
    <tr className="bg-canvas/80">
      <td colSpan={9} className="px-3 py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input
            label="Code"
            value={value.code}
            onChange={(e) => onChange({ ...value, code: e.target.value.toUpperCase() })}
            placeholder="DEALER"
            className="font-mono"
          />
          <Input
            label="Name"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="Dealer invoices"
          />
          <Input
            label="Prefix"
            value={value.prefix}
            onChange={(e) => onChange({ ...value, prefix: e.target.value.toUpperCase() })}
            className="font-mono"
          />
          <Input
            label="Pattern"
            value={value.pattern}
            onChange={(e) => onChange({ ...value, pattern: e.target.value })}
            helper="Tokens: {PREFIX} {YYYY} {YY} {FY} {MM} {SEQ}"
            className="font-mono text-caption"
          />
          <Input
            label="Pad width"
            type="number"
            value={String(value.padWidth)}
            onChange={(e) => onChange({ ...value, padWidth: Number(e.target.value) || 4 })}
          />
          <Input
            label="Start #"
            type="number"
            value={String(value.startNumber)}
            onChange={(e) => onChange({ ...value, startNumber: Number(e.target.value) || 1 })}
          />
          <Input
            label="Next #"
            type="number"
            value={String(value.nextNumber ?? value.startNumber)}
            onChange={(e) => onChange({ ...value, nextNumber: Number(e.target.value) || 1 })}
          />
          <label className="block text-caption text-ink-muted">
            Reset period
            <select
              className="mt-1 w-full h-9 border border-border rounded-md px-2 text-body-sm bg-white"
              value={value.resetPeriod}
              onChange={(e) =>
                onChange({
                  ...value,
                  resetPeriod: e.target.value as DocumentSeriesInput["resetPeriod"],
                })
              }
            >
              {RESET_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-caption text-ink-muted">
            Auto-route channel
            <select
              className="mt-1 w-full h-9 border border-border rounded-md px-2 text-body-sm bg-white"
              value={value.channelSource ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  channelSource: (e.target.value || null) as DocumentSeriesInput["channelSource"],
                })
              }
            >
              {CHANNELS.map((c) => (
                <option key={c.value || "none"} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 h-9 mt-5 text-body-sm">
            <input
              type="checkbox"
              checked={value.isDefault ?? false}
              onChange={(e) => onChange({ ...value, isDefault: e.target.checked })}
            />
            Default scheme
          </label>
          <label className="flex items-center gap-2 h-9 mt-5 text-body-sm">
            <input
              type="checkbox"
              checked={value.active ?? true}
              onChange={(e) => onChange({ ...value, active: e.target.checked })}
            />
            Active
          </label>
        </div>
        <div className="mt-3 flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={busy}>
            Save
          </Button>
        </div>
      </td>
    </tr>
  );

  return (
    <Card
      title="Invoice numbering schemes"
      subtitle="Configure prefixes, patterns, and channel routing. Customers can override with an assigned scheme."
      actions={
        !draft && !editId ? (
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => {
              setDraft(emptyDraft());
              setEditId(null);
            }}
            disabled={busy}
          >
            Add scheme
          </Button>
        ) : null
      }
      noPadding
    >
      {loading ? (
        <div className="p-8 flex justify-center text-ink-muted">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-canvas text-caption uppercase font-semibold text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Pattern</th>
                <th className="text-left px-3 py-2">Channel</th>
                <th className="text-right px-3 py-2">Next #</th>
                <th className="text-left px-3 py-2">Preview</th>
                <th className="text-center px-3 py-2">Default</th>
                <th className="text-center px-3 py-2">Active</th>
                <th className="text-right px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {draft &&
                renderForm(draft, setDraft, saveNew, () => setDraft(null))}
              {rows.map((r) =>
                editId === r.id && editDraft ? (
                  renderForm(
                    editDraft,
                    setEditDraft,
                    saveEdit,
                    () => {
                      setEditId(null);
                      setEditDraft(null);
                    }
                  )
                ) : (
                  <tr key={r.id} className="border-t border-border hover:bg-canvas/40">
                    <td className="px-3 py-2 font-mono font-semibold">{r.code}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-caption">{r.pattern}</td>
                    <td className="px-3 py-2 text-caption">{r.channelSource ?? "—"}</td>
                    <td className="px-3 py-2 text-right tnum">{r.nextNumber}</td>
                    <td className="px-3 py-2 font-mono text-caption">{r.previewNext ?? "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {r.isDefault ? <Chip tone="primary">Default</Chip> : null}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Chip tone={r.active ? "success" : "neutral"}>
                        {r.active ? "Yes" : "No"}
                      </Chip>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-canvas"
                          onClick={() => startEdit(r)}
                          disabled={busy}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:text-danger hover:bg-canvas"
                          onClick={() => void remove(r)}
                          disabled={busy || r.isDefault}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
