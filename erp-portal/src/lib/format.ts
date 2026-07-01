export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

/** Paise-precision currency — for GST splits and taxable subtotals (avoids 5% looking like 6%). */
export const inrPaise = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

/** AR ledger running balance — Dr = customer owes us, Cr = advance on account. */
export function arBalanceInr(balance: number): {
  text: string;
  tone: "owed" | "advance" | "zero";
} {
  if (balance > 0) return { text: `Dr ${inr(balance)}`, tone: "owed" };
  if (balance < 0) return { text: `Cr ${inr(Math.abs(balance))}`, tone: "advance" };
  return { text: inr(0), tone: "zero" };
}

export const num = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);

/** Variant packSize in parent UoM — keeps decimals for sub-unit packs (0.1 kg = 100 g). */
export const formatPackSize = (n: number): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v - Math.round(v)) < 1e-9) return num(v, 0);
  if (v >= 1) return num(v, 3);
  const decimals = Math.min(6, Math.max(1, Math.ceil(-Math.log10(Math.abs(v))) + 1));
  return num(v, decimals);
};

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export const dt = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export const dd = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export const relative = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};
