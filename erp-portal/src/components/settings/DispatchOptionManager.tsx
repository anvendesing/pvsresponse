// Admin CRUD for dispatch / transport modes (Settings → Dispatch options).

import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Truck, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import {
  api,
  apiEnabled,
  DISPATCH_CATEGORY_LABELS,
  type DispatchOptionRow,
} from "@/lib/api";
import { inr } from "@/lib/format";

interface FormState {
  code: string;
  name: string;
  category: string;
  description: string;
  defaultCharge: number;
  active: boolean;
  sortOrder: number;
}

const EMPTY: FormState = {
  code: "",
  name: "",
  category: "bulk_carrier",
  description: "",
  defaultCharge: 0,
  active: true,
  sortOrder: 0,
};

export const DispatchOptionManager = () => {
  const [rows, setRows] = useState<DispatchOptionRow[]>([]);
  const [categories, setCategories] = useState<{ code: string; label: string }[]>([]);
  const [loading, setLoading] = useState(apiEnabled);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DispatchOptionRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const load = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([
        api.settingsDispatchOptions(),
        api.dispatchCategories(),
      ]);
      setRows(list);
      setCategories(cats);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, DispatchOptionRow[]>();
    for (const r of rows) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return map;
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, sortOrder: rows.length + 1 });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (r: DispatchOptionRow) => {
    setEditing(r);
    setForm({
      code: r.code,
      name: r.name,
      category: r.category,
      description: r.description ?? "",
      defaultCharge: r.defaultCharge,
      active: r.active !== false,
      sortOrder: r.sortOrder ?? 0,
    });
    setError(null);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and name are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        code: form.code.trim().toLowerCase().replace(/\s+/g, "_"),
        name: form.name.trim(),
        category: form.category,
        description: form.description.trim() || null,
        defaultCharge: form.defaultCharge,
        active: form.active,
        sortOrder: form.sortOrder,
      };
      if (editing) {
        await api.updateDispatchOption(editing.id, payload);
        setBanner(`Updated ${payload.name}.`);
      } else {
        await api.createDispatchOption(payload);
        setBanner(`Added ${payload.name}.`);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: DispatchOptionRow) => {
    if (!confirm(`Delete "${r.name}"? Quotes referencing it must be cleared first.`)) return;
    setBusy(true);
    try {
      await api.deleteDispatchOption(r.id);
      setBanner(`Deleted ${r.name}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (r: DispatchOptionRow) => {
    setBusy(true);
    try {
      await api.updateDispatchOption(r.id, { active: r.active === false });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-h3 font-bold flex items-center gap-2">
            <Truck size={20} className="text-primary" />
            Dispatch options
          </h2>
          <p className="text-body-sm text-ink-muted mt-1 max-w-2xl">
            Transport modes offered on quotes — door delivery, bulk carriers
            (Navata, VRL, Janata), company vehicles, RTC / bus cargo, railway,
            couriers, and customer pick-up. Each option can suggest a default
            freight charge that pre-fills the quote form.
          </p>
        </div>
        <Button size="sm" icon={<Plus size={14} />} onClick={openCreate}>
          Add option
        </Button>
      </div>

      {banner && (
        <div className="rounded-md bg-success-soft border border-success text-success px-3 py-2 text-body-sm">
          {banner}
        </div>
      )}
      {error && !modalOpen && (
        <div className="rounded-md bg-danger-soft border border-danger text-danger px-3 py-2 text-body-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-ink-muted py-8">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([cat, items]) => (
            <section key={cat}>
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-muted mb-2">
                {DISPATCH_CATEGORY_LABELS[cat] ?? cat}
              </h3>
              <div className="space-y-2">
                {items.map((r) => (
                  <Card key={r.id} className="p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{r.name}</span>
                          <span className="font-mono text-caption text-ink-muted">
                            {r.code}
                          </span>
                          {r.active === false && (
                            <Chip size="sm" tone="neutral">
                              Inactive
                            </Chip>
                          )}
                        </div>
                        {r.description && (
                          <p className="text-caption text-ink-muted mt-0.5">
                            {r.description}
                          </p>
                        )}
                        <p className="text-caption text-ink-muted mt-1">
                          Default freight: {inr(r.defaultCharge)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActive(r)}
                          disabled={busy}
                        >
                          {r.active === false ? "Activate" : "Deactivate"}
                        </Button>
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="h-8 w-8 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          className="h-8 w-8 grid place-items-center rounded-md text-danger hover:bg-danger-soft"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4"
          onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}
        >
          <div className="bg-surface w-full max-w-md rounded-lg shadow-xl border border-border">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="font-bold">
                {editing ? "Edit dispatch option" : "New dispatch option"}
              </span>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-canvas"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {error && (
                <div className="text-body-sm text-danger">{error}</div>
              )}
              <label className="block text-body-sm">
                <span className="text-caption text-ink-muted">Code</span>
                <Input
                  value={form.code}
                  disabled={!!editing}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="navata"
                  className="mt-1 font-mono"
                />
              </label>
              <label className="block text-body-sm">
                <span className="text-caption text-ink-muted">Display name</span>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Navata Road Transport"
                  className="mt-1"
                />
              </label>
              <label className="block text-body-sm">
                <span className="text-caption text-ink-muted">Category</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="mt-1 w-full h-9 rounded-md border border-border bg-surface px-2 text-body-sm"
                >
                  {categories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-body-sm">
                <span className="text-caption text-ink-muted">Description</span>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="mt-1"
                />
              </label>
              <label className="block text-body-sm">
                <span className="text-caption text-ink-muted">
                  Default freight (₹, excl. GST)
                </span>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={form.defaultCharge}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      defaultCharge: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="mt-1"
                />
              </label>
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Active (shown on quote form)
              </label>
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? "Saving…" : editing ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
