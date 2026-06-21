export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
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
