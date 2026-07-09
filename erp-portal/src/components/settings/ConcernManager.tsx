// Storefront "Shop by Concern" master data — admin CRUD + tile image upload.

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, resolveUploadUrl } from "@/lib/api";
import type { ProductConcern } from "@/data/types";
import { backdropDismissProps } from "@/hooks/useBackdropDismiss";

const imgSrc = (url: string | null | undefined) => resolveUploadUrl(url);

interface FormState {
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  active: boolean;
}

const EMPTY: FormState = {
  slug: "",
  name: "",
  description: "",
  icon: "",
  sortOrder: 0,
  active: true,
};

export const ConcernManager = () => {
  const [rows, setRows] = useState<ProductConcern[]>([]);
  const [loading, setLoading] = useState(apiEnabled);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductConcern | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const [banner, setBanner] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const load = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    try {
      const list = await api.productConcerns();
      setRows(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, sortOrder: rows.length + 1 });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (c: ProductConcern) => {
    setEditing(c);
    setForm({
      slug: c.slug,
      name: c.name,
      description: c.description ?? "",
      icon: c.icon ?? "",
      sortOrder: c.sortOrder,
      active: c.active,
    });
    setError(null);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.slug.trim() || !form.name.trim()) {
      setError("Slug and name are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        slug: form.slug.trim().toLowerCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        icon: form.icon.trim() || null,
        sortOrder: form.sortOrder,
        active: form.active,
      };
      if (editing) {
        await api.updateProductConcern(editing.id, body);
        setBanner(`Concern "${form.name}" updated.`);
      } else {
        await api.createProductConcern(body);
        setBanner(`Concern "${form.name}" created.`);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: ProductConcern) => {
    const count = c._count?.products ?? 0;
    if (count > 0) {
      setError(`Cannot delete: ${count} product(s) still linked to "${c.name}".`);
      return;
    }
    if (!confirm(`Delete concern "${c.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteProductConcern(c.id);
      setBanner(`Concern "${c.name}" deleted.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (c: ProductConcern, file: File) => {
    setUploadingId(c.id);
    setError(null);
    try {
      await api.uploadConcernImage(c.id, file);
      setBanner(`Image updated for "${c.name}".`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {banner && (
        <div className="bg-success-soft border border-success text-success px-3 py-2 rounded-md text-body-sm flex justify-between">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="underline text-caption">
            dismiss
          </button>
        </div>
      )}
      {error && !modalOpen && (
        <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
          {error}
        </div>
      )}

      <Card
        title="Product concerns"
        actions={
          <Button size="sm" icon={<Plus size={14} />} onClick={openCreate}>
            Add concern
          </Button>
        }
      >
        <p className="text-body-sm text-ink-muted px-4 pb-3 border-b border-border">
          Concerns power &quot;Shop by Concern&quot; on the storefront. Products can belong to
          multiple concerns (unlike categories). Deactivate to hide without deleting.
        </p>
        {loading ? (
          <div className="p-8 grid place-items-center text-ink-muted">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-center gap-4">
                <button
                  type="button"
                  className="relative w-14 h-14 rounded-md border border-border overflow-hidden flex-shrink-0 bg-canvas"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = () => {
                      const f = input.files?.[0];
                      if (f) void uploadImage(c, f);
                    };
                    input.click();
                  }}
                  title="Upload concern image"
                >
                  {imgSrc(c.imageUrl) ? (
                    <img src={imgSrc(c.imageUrl)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full grid place-items-center text-ink-muted">
                      {c.icon ? (
                        <span className="text-lg">{c.icon}</span>
                      ) : (
                        <ImagePlus size={18} />
                      )}
                    </span>
                  )}
                  {uploadingId === c.id && (
                    <span className="absolute inset-0 bg-ink/50 grid place-items-center text-white text-caption">
                      …
                    </span>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink">{c.name}</div>
                  <div className="text-caption text-ink-muted font-mono">
                    /concern/{c.slug} · sort {c.sortOrder}
                    {c._count?.products != null ? ` · ${c._count.products} products` : ""}
                  </div>
                </div>
                <Chip tone={c.active ? "success" : "neutral"} size="sm">
                  {c.active ? "Active" : "Hidden"}
                </Chip>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" icon={<Pencil size={12} />} onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Trash2 size={12} />}
                    onClick={() => void remove(c)}
                    disabled={busy}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {modalOpen && (
        <div className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center" {...backdropDismissProps(closeModal)}>
          <div
            className="bg-surface w-full max-w-md rounded-lg elevation-3 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-border flex justify-between items-center">
              <div className="font-bold">{editing ? "Edit concern" : "New concern"}</div>
              <button onClick={() => setModalOpen(false)} className="text-ink-muted">
                <X size={18} />
              </button>
            </div>
            {error && (
              <div className="px-4 py-2 bg-danger-soft text-danger text-body-sm border-b border-danger">{error}</div>
            )}
            <div className="p-4 space-y-3">
              <div>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-1">Slug (URL)</div>
                <Input
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                    }))
                  }
                  placeholder="diabetes-management"
                  disabled={!!editing}
                />
              </div>
              <div>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-1">Display name</div>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-1">Description</div>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional short blurb for storefront"
                />
              </div>
              <div>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-1">Icon (emoji)</div>
                <Input
                  value={form.icon}
                  onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                  placeholder="🩺"
                />
              </div>
              <div>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-1">Sort order</div>
                <Input
                  type="number"
                  value={String(form.sortOrder)}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
                />
              </div>
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Visible on storefront
              </label>
            </div>
            <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <input ref={imgRef} type="file" accept="image/*" className="hidden" />
    </div>
  );
};
