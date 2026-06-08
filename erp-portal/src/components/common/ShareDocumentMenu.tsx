// Reusable "Share document" dropdown. Used for Quotes, Sales Orders,
// Invoices and Packing Slips. Each shareable document type plugs in via a
// `descriptor` that knows the share URL prefix, default email/whatsapp
// templates, and how to (lazy-)mint or rotate its share token.
//
// The menu lives in a portal so parent containers with overflow:auto
// (e.g. table cells) don't clip it.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Share2,
  Printer,
  Link2,
  MessageCircle,
  Mail,
  RefreshCw,
  Check,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { cn } from "@/lib/cn";

const MENU_WIDTH = 320;
const MENU_MAX_HEIGHT = 420;

export type DocKind =
  | "quote"
  | "sales-order"
  | "invoice"
  | "packing-slip"
  | "purchase-order";

const docLabel: Record<DocKind, string> = {
  quote: "quote",
  "sales-order": "sales order",
  invoice: "invoice",
  "packing-slip": "packing slip",
  "purchase-order": "purchase order",
};

const docPath: Record<DocKind, string> = {
  quote: "quote",
  "sales-order": "sales-order",
  invoice: "invoice",
  "packing-slip": "packing-slip",
  "purchase-order": "purchase-order",
};

export interface ShareDescriptor {
  kind: DocKind;
  // Identifier passed to onMintToken / onRotateToken (the doc's row id).
  id: string;
  // Human-readable doc number, e.g. "INV-2026-5501"
  docNo: string;
  // Existing share token (if any); the menu lazily mints one when null.
  shareToken?: string | null;
  // Customer info used by the share-channel templates.
  customerName: string;
  customerContact?: string | null;
  // Total amount in INR; rendered inside the email/whatsapp message.
  total?: number | null;
  // Optional one-line context for the message body, e.g.
  // "Valid until 2026-06-30" for quotes.
  contextLine?: string;
  // Mint or rotate the token. Both should return the new token. Most
  // consumers wire both to the same backend endpoint
  // (POST /v1/<docs>/:id/rotate-share-token).
  rotateToken: (id: string) => Promise<string>;
  // Called whenever a fresh token comes back, so the parent can update
  // its row state.
  onTokenChanged?: (token: string) => void;
}

interface Props {
  descriptor: ShareDescriptor;
  size?: "sm" | "md";
  // Optional override for the trigger button label; defaults to "Share".
  label?: string;
}

const inrFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const buildGreeting = (d: ShareDescriptor, url: string) => {
  const lbl = docLabel[d.kind];
  const tot = d.total != null ? ` for ${inrFmt.format(d.total)}` : "";
  // POs are issued to a vendor rather than a customer; use a slightly
  // different verb so the message reads naturally.
  if (d.kind === "purchase-order") {
    return `Hi ${d.customerName}, we have raised ${lbl} ${d.docNo}${tot}. View online: ${url}`;
  }
  return `Hi ${d.customerName}, please find ${lbl} ${d.docNo}${tot}. View online: ${url}`;
};

/** Clipboard API is blocked on plain HTTP (typical IP-only VPS). Fall back
 *  to execCommand so "Copy link" works without TLS. */
const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Secure-context requirement or permission denied — try fallback.
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

const buildEmail = (d: ShareDescriptor, url: string) => {
  const lbl = docLabel[d.kind];
  const subject = `${
    d.kind === "invoice"
      ? "Invoice"
      : d.kind === "sales-order"
        ? "Order Confirmation"
        : d.kind === "packing-slip"
          ? "Dispatch Note"
          : d.kind === "purchase-order"
            ? "Purchase Order"
            : "Quotation"
  } ${d.docNo}`;
  const totalLine = d.total != null ? ` for ${inrFmt.format(d.total)}` : "";
  const ctxLine = d.contextLine ? `${d.contextLine}\n\n` : "";
  const body =
    `Dear ${d.customerName},\n\n` +
    `Please find the attached ${lbl} ${d.docNo}${totalLine}.\n` +
    `View online: ${url}\n\n` +
    ctxLine +
    `Regards`;
  return { subject, body };
};

export const ShareDocumentMenu = ({ descriptor, size = "md", label = "Share" }: Props) => {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(descriptor.shareToken ?? null);
  const [working, setWorking] = useState<"mint" | "rotate" | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const recomputePos = () => {
    const btn = triggerRef.current?.querySelector("button");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < MENU_MAX_HEIGHT && rect.top > spaceBelow;
    const top = flipUp ? rect.top - 6 - MENU_MAX_HEIGHT : rect.bottom + 6;
    let left = rect.right - MENU_WIDTH;
    if (left < 8) left = 8;
    if (left + MENU_WIDTH > window.innerWidth - 8) {
      left = window.innerWidth - MENU_WIDTH - 8;
    }
    setPos({ top: Math.max(8, top), left });
  };

  useLayoutEffect(() => {
    if (open) recomputePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleScrollOrResize = () => recomputePos();
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (descriptor.shareToken && descriptor.shareToken !== token) {
      setToken(descriptor.shareToken);
    }
  }, [descriptor.shareToken, token]);

  // Lazy mint on first open for legacy rows that pre-date sharing.
  useEffect(() => {
    if (!open || token || working) return;
    setWorking("mint");
    void (async () => {
      try {
        const newToken = await descriptor.rotateToken(descriptor.id);
        setToken(newToken);
        descriptor.onTokenChanged?.(newToken);
      } catch (e) {
        console.error("mint share token failed", e);
      } finally {
        setWorking(null);
      }
    })();
  }, [open, token, working, descriptor]);

  const url = token
    ? `${window.location.origin}/share/${docPath[descriptor.kind]}/${token}`
    : "";

  const onPrint = () => {
    if (!url) return;
    window.open(`${url}?print=1`, "_blank");
    setOpen(false);
  };

  const onCopy = async () => {
    if (!url) return;
    setCopyError(null);
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyError("Copy blocked — select the link above and copy manually (Ctrl+C).");
    }
  };

  const onWhatsApp = () => {
    if (!url) return;
    const phone = (descriptor.customerContact ?? "").replace(/\D/g, "");
    const dest = phone ? `https://wa.me/${phone}` : "https://wa.me/";
    const msg = buildGreeting(descriptor, url);
    window.open(`${dest}?text=${encodeURIComponent(msg)}`, "_blank");
    setOpen(false);
  };

  const onEmail = () => {
    if (!url) return;
    const { subject, body } = buildEmail(descriptor, url);
    window.location.href = `mailto:?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    setOpen(false);
  };

  const onRotate = async () => {
    if (
      !confirm(
        "Revoke the current link and issue a new one? Anyone holding the old link will lose access."
      )
    )
      return;
    setWorking("rotate");
    try {
      const newToken = await descriptor.rotateToken(descriptor.id);
      setToken(newToken);
      descriptor.onTokenChanged?.(newToken);
    } catch (e) {
      console.error("rotate failed", e);
    } finally {
      setWorking(null);
    }
  };

  const lbl = docLabel[descriptor.kind];

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: MENU_WIDTH,
              zIndex: 1000,
            }}
            className="bg-surface border border-border rounded-md shadow-lg overflow-hidden"
          >
            <div className="px-3 py-2.5 border-b border-border bg-canvas">
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Share this {lbl}
              </div>
              <div
                className="text-body-sm font-mono mt-1 truncate select-all"
                title={url}
              >
                {working === "mint" ? "Minting link…" : token ? url : "—"}
              </div>
              {copyError ? (
                <div className="text-caption text-warning mt-1">{copyError}</div>
              ) : null}
            </div>

            <button
              onClick={onPrint}
              disabled={!token}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Printer size={16} className="text-ink-muted" />
              <div>
                <div className="text-body-sm font-medium">Print / Save as PDF</div>
                <div className="text-caption text-ink-muted">Browser print dialog</div>
              </div>
            </button>

            <button
              onClick={onCopy}
              disabled={!token}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed border-t border-border"
            >
              {copied ? (
                <Check size={16} className="text-success" />
              ) : (
                <Link2 size={16} className="text-ink-muted" />
              )}
              <div>
                <div className="text-body-sm font-medium">
                  {copied ? "Link copied" : "Copy link"}
                </div>
                <div className="text-caption text-ink-muted">Share manually</div>
              </div>
            </button>

            <button
              onClick={onWhatsApp}
              disabled={!token}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed border-t border-border"
            >
              <MessageCircle size={16} className="text-[#25D366]" />
              <div>
                <div className="text-body-sm font-medium">Send via WhatsApp</div>
                <div className="text-caption text-ink-muted truncate">
                  {descriptor.customerContact
                    ? `to ${descriptor.customerContact}`
                    : "choose contact in WhatsApp"}
                </div>
              </div>
            </button>

            <button
              onClick={onEmail}
              disabled={!token}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed border-t border-border"
            >
              <Mail size={16} className="text-ink-muted" />
              <div>
                <div className="text-body-sm font-medium">Send via Email</div>
                <div className="text-caption text-ink-muted">Open default mail app</div>
              </div>
            </button>

            <button
              onClick={onRotate}
              disabled={!token || working === "rotate"}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-danger-soft border-t border-border",
                "disabled:opacity-50 disabled:cursor-not-allowed text-danger"
              )}
            >
              <RefreshCw
                size={16}
                className={working === "rotate" ? "animate-spin" : ""}
              />
              <div>
                <div className="text-body-sm font-medium">Revoke &amp; rotate link</div>
                <div className="text-caption text-danger/70">
                  Invalidates the current share URL
                </div>
              </div>
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={triggerRef} className="inline-block">
      <Button
        size={size}
        variant="primary"
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5"
      >
        <Share2 size={14} />
        {label}
      </Button>
      {menu}
    </div>
  );
};
