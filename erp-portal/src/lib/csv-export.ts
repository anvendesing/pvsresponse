// Client-side CSV download for list/table exports. Matches the backend
// RFC-4180 style used by /reports/* so Excel opens files cleanly.

const escapeCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export const toCsv = (
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): string => {
  const out: string[] = [];
  out.push(headers.map(escapeCell).join(","));
  for (const r of rows) {
    out.push(r.map(escapeCell).join(","));
  }
  return out.join("\r\n") + "\r\n";
};

/** Trigger a browser download of a CSV file. */
export const downloadCsv = (
  filename: string,
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): void => {
  const csv = toCsv(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const csvStamp = (): string => new Date().toISOString().slice(0, 10);
