/**
 * Configurable document numbering — atomic counter per series.
 *
 * Resolution order for invoices:
 *   1. Series with matching channelSource (imported, ecommerce, pos, internal)
 *   2. Customer.documentSeriesId override
 *   3. isDefault series for documentType
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "../db.js";

export type DocumentType = "invoice" | "quote" | "sales_order" | "credit_note";
export type ResetPeriod = "never" | "yearly" | "fiscal" | "monthly";

export type DocumentSeriesRow = {
  id: string;
  code: string;
  name: string;
  documentType: string;
  prefix: string;
  pattern: string;
  padWidth: number;
  startNumber: number;
  nextNumber: number;
  resetPeriod: string;
  lastPeriodKey: string | null;
  channelSource: string | null;
  isDefault: boolean;
  active: boolean;
};

type Tx = Prisma.TransactionClient | PrismaClient;

export type AllocateInvoiceOpts = {
  customerId: string;
  /** SalesOrder.source or explicit channel: internal | imported | ecommerce | pos */
  source?: string | null;
  /** Override channel routing (e.g. POS walk-in billing) */
  channel?: string | null;
  at?: Date;
};

export type AllocatedNumber = {
  documentNo: string;
  seriesId: string;
  seriesSeq: number;
};

const padSeq = (n: number, width: number) => String(n).padStart(width, "0");

/** Indian fiscal year label e.g. 2025-26 from date + fiscalYearStart MM-DD. */
export const fiscalYearLabel = (date: Date, fiscalYearStart: string): string => {
  const [mmStr, ddStr] = fiscalYearStart.split("-");
  const fyStartMonth = parseInt(mmStr ?? "4", 10) - 1;
  const fyStartDay = parseInt(ddStr ?? "1", 10);
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const beforeFy =
    m < fyStartMonth || (m === fyStartMonth && d < fyStartDay);
  const startYear = beforeFy ? y - 1 : y;
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, "0")}`;
};

export const periodKeyForSeries = (
  resetPeriod: string,
  date: Date,
  fiscalYearStart: string
): string | null => {
  switch (resetPeriod as ResetPeriod) {
    case "never":
      return null;
    case "yearly":
      return String(date.getFullYear());
    case "monthly":
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    case "fiscal":
      return fiscalYearLabel(date, fiscalYearStart);
    default:
      return String(date.getFullYear());
  }
};

export const formatDocumentNumber = (
  series: Pick<DocumentSeriesRow, "prefix" | "pattern" | "padWidth">,
  seq: number,
  date: Date,
  fiscalYearStart: string
): string => {
  const yyyy = String(date.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const fy = fiscalYearLabel(date, fiscalYearStart);
  const seqPadded = padSeq(seq, series.padWidth);
  return series.pattern
    .replace(/\{PREFIX\}/g, series.prefix)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yy)
    .replace(/\{FY\}/g, fy)
    .replace(/\{MM\}/g, mm)
    .replace(/\{SEQ\}/g, seqPadded);
};

/** Preview the next number without consuming the counter. */
export const previewNextNumber = (
  series: DocumentSeriesRow,
  fiscalYearStart: string,
  at = new Date()
): string => {
  const periodKey = periodKeyForSeries(series.resetPeriod, at, fiscalYearStart);
  const seq =
    series.resetPeriod === "never" || !periodKey || series.lastPeriodKey === periodKey
      ? series.nextNumber
      : series.startNumber;
  return formatDocumentNumber(series, seq, at, fiscalYearStart);
};

const channelFromSource = (source?: string | null): string | null => {
  if (!source) return null;
  if (source === "imported") return "imported";
  if (source === "ecommerce") return "ecommerce";
  if (source === "pos") return "pos";
  if (source === "internal") return "internal";
  return source;
};

export const resolveInvoiceSeriesId = async (
  tx: Tx,
  opts: AllocateInvoiceOpts
): Promise<string> => {
  const channel = opts.channel ?? channelFromSource(opts.source);

  if (channel) {
    const byChannel = await tx.documentSeries.findFirst({
      where: { documentType: "invoice", active: true, channelSource: channel },
      select: { id: true },
    });
    if (byChannel) return byChannel.id;
  }

  const customer = await tx.customer.findUnique({
    where: { id: opts.customerId },
    select: { documentSeriesId: true },
  });
  if (customer?.documentSeriesId) {
    const assigned = await tx.documentSeries.findFirst({
      where: {
        id: customer.documentSeriesId,
        documentType: "invoice",
        active: true,
      },
      select: { id: true },
    });
    if (assigned) return assigned.id;
  }

  const fallback = await tx.documentSeries.findFirst({
    where: { documentType: "invoice", active: true, isDefault: true },
    select: { id: true },
  });
  if (fallback) return fallback.id;

  const any = await tx.documentSeries.findFirst({
    where: { documentType: "invoice", active: true },
    orderBy: { code: "asc" },
    select: { id: true },
  });
  if (!any) {
    throw new Error("No active invoice document series configured.");
  }
  return any.id;
};

/** Backfill nextNumber from existing invoices matching a prefix pattern. */
export const syncSeriesCounterFromInvoices = async (
  seriesId: string,
  prefixHint: string
): Promise<number> => {
  const rows = await db.invoice.findMany({
    where: { invoiceNo: { startsWith: prefixHint } },
    select: { invoiceNo: true },
  });
  const tails = rows
    .map((r) => parseInt(r.invoiceNo.split("-").pop() ?? "0", 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const max = tails.length > 0 ? Math.max(...tails) : 0;
  if (max <= 0) return 0;
  await db.documentSeries.update({
    where: { id: seriesId },
    data: { nextNumber: max + 1 },
  });
  return max + 1;
};

export const ensureDocumentSeriesSeeded = async (): Promise<void> => {
  const count = await db.documentSeries.count();
  if (count > 0) {
    const b2b = await db.documentSeries.findUnique({ where: { code: "B2B" } });
    const imp = await db.documentSeries.findUnique({ where: { code: "IMPORT" } });
    if (b2b && b2b.nextNumber <= 5501) {
      await syncSeriesCounterFromInvoices(b2b.id, "INV-2026-");
    }
    if (imp && imp.nextNumber <= 1) {
      await syncSeriesCounterFromInvoices(imp.id, "IMP-INV-2026-");
    }
    return;
  }

  const profile = await db.companyProfile.findUnique({
    where: { key: "default" },
    select: { invoicePrefix: true },
  });
  const prefix = profile?.invoicePrefix ?? "INV";

  await db.documentSeries.createMany({
    data: [
      {
        id: "docseries_b2b_default",
        code: "B2B",
        name: "B2B / Standard Invoices",
        documentType: "invoice",
        prefix,
        pattern: "{PREFIX}-{YYYY}-{SEQ}",
        padWidth: 4,
        startNumber: 5501,
        nextNumber: 5501,
        resetPeriod: "yearly",
        isDefault: true,
        active: true,
      },
      {
        id: "docseries_import",
        code: "IMPORT",
        name: "PDF Import Invoices",
        documentType: "invoice",
        prefix: "IMP-INV",
        pattern: "{PREFIX}-{YYYY}-{SEQ}",
        padWidth: 4,
        startNumber: 1,
        nextNumber: 1,
        resetPeriod: "yearly",
        channelSource: "imported",
        active: true,
      },
    ],
  });

  await syncSeriesCounterFromInvoices("docseries_b2b_default", `${prefix}-2026-`);
  await syncSeriesCounterFromInvoices("docseries_import", "IMP-INV-2026-");
};

/**
 * Atomically allocate the next invoice number inside a transaction.
 * Uses SELECT … FOR UPDATE on PostgreSQL.
 */
export const allocateInvoiceNumber = async (
  tx: Tx,
  opts: AllocateInvoiceOpts
): Promise<AllocatedNumber> => {
  const seriesId = await resolveInvoiceSeriesId(tx, opts);
  const at = opts.at ?? new Date();

  const profile = await tx.companyProfile.findUnique({
    where: { key: "default" },
    select: { fiscalYearStart: true },
  });
  const fiscalYearStart = profile?.fiscalYearStart ?? "04-01";

  const locked = await tx.$queryRaw<DocumentSeriesRow[]>`
    SELECT id, code, name, "documentType", prefix, pattern, "padWidth",
           "startNumber", "nextNumber", "resetPeriod", "lastPeriodKey",
           "channelSource", "isDefault", active
    FROM "DocumentSeries"
    WHERE id = ${seriesId}
    FOR UPDATE
  `;
  const series = locked[0];
  if (!series || !series.active) {
    throw new Error(`Document series ${seriesId} is not active.`);
  }

  const seriesPeriodKey = periodKeyForSeries(series.resetPeriod, at, fiscalYearStart);
  let seq = series.nextNumber;
  if (
    series.resetPeriod !== "never" &&
    seriesPeriodKey &&
    series.lastPeriodKey !== seriesPeriodKey
  ) {
    seq = series.startNumber;
  }

  const documentNo = formatDocumentNumber(series, seq, at, fiscalYearStart);

  await tx.documentSeries.update({
    where: { id: seriesId },
    data: {
      nextNumber: seq + 1,
      lastPeriodKey: seriesPeriodKey,
    },
  });

  return { documentNo, seriesId, seriesSeq: seq };
};
