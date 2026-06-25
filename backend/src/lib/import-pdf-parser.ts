// =====================================================================
// External shipping-label / sales-order PDF parser
// =====================================================================
// Extracts customer + line items from one specific external format —
// the DTDC-style "ship label + invoice" PDF that operators receive from
// upstream order channels (an example is shipped in the repo root as
// 9949715198.pdf). The format looks like:
//
//   Deliver To:
//   CI1005061
//   <buyer name>
//   <address line>
//   <area / landmark>
//   <city>
//   <pincode>
//   <phone>
//   ...
//   AWB #<awb>     Order #<external-order-no>
//   PREPAID COURIER: <carrier+service>
//   ITEM CODE ITEM QTY PRICE
//   I100 <description> <qty> Rs. <price>
//   I103 <description> <qty> Rs. <price>
//   ...
//   Invoice No. : <inv>| Invoice Date : <date>
//   <total-units> Rs. <grand-total>  TOTAL
//
// The line-item regex is forgiving about missing spaces (the PDF text
// extractor sometimes glues description and qty together — see
// "Jonnalu white Jowar Ravva1 KG 1 Rs. 114.29"). When the parser
// cannot derive a qty it falls back to 1 with a `note` for the
// operator to fix in the preview.

export interface ParsedOrderItem {
  externalCode: string; // raw item code from the PDF (e.g. "I100")
  description: string;  // best-effort description string
  qty: number;
  rate: number;         // unit price in ₹
  rawLine: string;      // for the preview "raw text" cell
  note?: string;        // optional warning, surfaced in the UI
}

export interface ParsedOrder {
  channelHint: string | null; // courier guessed from "PREPAID COURIER: DTDC ..."
  customer: {
    externalCode: string | null; // e.g. "CI1005061"
    name: string | null;
    addressLine: string | null;
    landmark: string | null;
    city: string | null;
    pincode: string | null;
    phone: string | null;
  };
  shipping: {
    awb: string | null;
    externalOrderNo: string | null;
    courier: string | null;
  };
  invoice: {
    externalInvoiceNo: string | null;
    invoiceDate: string | null;
  };
  totals: {
    totalUnits: number | null;
    grandTotal: number | null;
  };
  items: ParsedOrderItem[];
  // The full extracted text (debug aid; the UI may show a "raw text"
  // toggle so the operator can sanity-check before commit).
  rawText: string;
  // Lines we could not parse as items but that appeared between the
  // ITEM CODE header and the Invoice No. footer — surfaced in the
  // preview so the operator can hand-add them.
  unparsedItemLines: string[];
}

// PDFs extracted via pdf-parse / pdfjs frequently collapse whitespace
// at column boundaries, so most regexes here intentionally do NOT
// require a space between adjacent fields.
//
// Examples seen in the wild (DTDC shipping labels):
//   "AWB #7D118250350Order #SO12627100436"
//   "ITEM CODEITEMQTYPRICE"
//   "I100Andu Korralu  Brown Top Millet 1 KG1Rs. 228.57"
//   "53Rs. 7213.81TOTAL"
const RE_AWB_ORDER = /AWB\s*#\s*([A-Z0-9-]+)\s*Order\s*#\s*([A-Z0-9-]+)/i;
const RE_COURIER_LINE = /COURIER\s*:?\s*(.+)$/i;
const RE_INVOICE_LINE = /Invoice\s*No\.?\s*:\s*([^\s|]+)\s*\|?\s*Invoice\s*Date\s*:\s*(.+)/i;
// "53Rs. 7213.81TOTAL" — qty units, grand total, TOTAL keyword
const RE_TOTAL_LINE = /^(\d+)\s*Rs\.?\s*([\d.,]+)\s*TOTAL/i;
const RE_GSTIN = /^Gstin\s*No/i;
// "ITEM CODEITEMQTYPRICE" / "ITEM CODE ITEM QTY PRICE"
const RE_HEADER = /^ITEM\s*CODE\s*ITEM\s*QTY\s*PRICE/i;
const RE_PAGE_BREAK = /^--\s*\d+\s+of\s+\d+\s*--/i;
// "I100<rest>" — no space required between code and description.
const RE_ITEM_CODE_START = /^(I\d+)(.+)$/;

// Heuristic split for an item line body like "...descr... <qty>Rs. <price>"
// or "...descr... <qty> Rs. <price>".
//
// Strategy: split at the LAST "Rs." occurrence. Everything before is
// "<description><qty>" (possibly with no space between); the trailing
// integer run on the left side is the qty, the rest is the
// description.
const splitItemBody = (
  body: string
): { description: string; qty: number; rate: number; note?: string } => {
  const trimmed = body.replace(/\s+/g, " ").trim();
  // Find the last "Rs." in the line — the price is what follows it.
  const rsIdx = trimmed.toLowerCase().lastIndexOf("rs.");
  if (rsIdx < 0) {
    return {
      description: trimmed,
      qty: 1,
      rate: 0,
      note: "No 'Rs.' price found in line.",
    };
  }
  const beforeRs = trimmed.slice(0, rsIdx).trim();
  const afterRs = trimmed.slice(rsIdx + 3).trim();
  const rateMatch = afterRs.match(/^([\d.,]+)/);
  const rate = rateMatch ? parseFloat(rateMatch[1].replace(/,/g, "")) : 0;
  // qty = trailing run of digits on `beforeRs`.
  const qtyMatch = beforeRs.match(/(\d+)\s*$/);
  if (!qtyMatch) {
    return {
      description: beforeRs,
      qty: 1,
      rate,
      note: "Could not detect qty (no trailing integer).",
    };
  }
  const qty = parseInt(qtyMatch[1], 10);
  const description = beforeRs.slice(0, qtyMatch.index).trim();
  return { description: description || beforeRs, qty, rate };
};

// Customer block detection: lines 2..N before "AWB #..." form the
// deliver-to block. We expect: code (optional), name, addressLine,
// landmark, city, pincode, phone. The PDF in practice puts these in a
// fixed order but with slight variations — we extract conservatively
// by row index and let the operator correct in the preview.
const parseCustomerBlock = (
  lines: string[]
): ParsedOrder["customer"] => {
  // strip empty lines and the header
  const block: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/^Deliver\s*To/i.test(t)) continue;
    if (/^Shipped\s*By/i.test(t)) break;
    block.push(t);
  }
  const c: ParsedOrder["customer"] = {
    externalCode: null,
    name: null,
    addressLine: null,
    landmark: null,
    city: null,
    pincode: null,
    phone: null,
  };
  if (block.length === 0) return c;
  // Walk from the end: phone (10 digits), pincode (6 digits), city,
  // then everything in the middle is address + landmark, top is name +
  // optional external code.
  const remaining = [...block];

  // phone
  const phoneIdx = (() => {
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (/^\+?\d[\d\s-]{8,}$/.test(remaining[i])) return i;
    }
    return -1;
  })();
  if (phoneIdx >= 0) {
    c.phone = remaining[phoneIdx].replace(/\D/g, "");
    remaining.splice(phoneIdx, 1);
  }
  // pincode (6 digits)
  const pinIdx = (() => {
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (/^\d{6}$/.test(remaining[i])) return i;
    }
    return -1;
  })();
  if (pinIdx >= 0) {
    c.pincode = remaining[pinIdx];
    remaining.splice(pinIdx, 1);
  }
  // city = the line just before pincode position; if pinIdx removed,
  // it's now at pinIdx (or the next-to-last entry).
  if (pinIdx >= 0 && pinIdx <= remaining.length) {
    const candidate = remaining[Math.min(pinIdx, remaining.length - 1)];
    if (candidate && !/^\d/.test(candidate)) {
      c.city = candidate;
      remaining.splice(Math.min(pinIdx, remaining.length - 1), 1);
    }
  }
  // First line: external customer code (CI...)
  if (remaining.length > 0 && /^[A-Z]{1,3}\d{4,}$/.test(remaining[0])) {
    c.externalCode = remaining[0];
    remaining.shift();
  }
  // Next: name
  if (remaining.length > 0) {
    c.name = remaining.shift() ?? null;
  }
  // Address line = first remaining
  if (remaining.length > 0) {
    c.addressLine = remaining.shift() ?? null;
  }
  // Landmark = join the rest
  if (remaining.length > 0) {
    c.landmark = remaining.join(", ");
  }
  return c;
};

export const parseOrderPdfText = (rawText: string): ParsedOrder => {
  const lines = rawText.split(/\r?\n/);

  // Headers / footers
  let awb: string | null = null;
  let extOrder: string | null = null;
  let courier: string | null = null;
  let extInvoiceNo: string | null = null;
  let invoiceDate: string | null = null;
  let totalUnits: number | null = null;
  let grandTotal: number | null = null;

  // Carve out the customer block: from start until the first AWB line.
  let awbLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(RE_AWB_ORDER);
    if (m) {
      awb = m[1];
      extOrder = m[2];
      awbLineIdx = i;
      break;
    }
  }
  const customer =
    awbLineIdx > 0 ? parseCustomerBlock(lines.slice(0, awbLineIdx)) : parseCustomerBlock(lines);

  // Walk the rest looking for item-table rows + invoice + total.
  let inItemSection = false;
  const items: ParsedOrderItem[] = [];
  const unparsedItemLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (RE_HEADER.test(t)) {
      inItemSection = true;
      continue;
    }
    if (RE_PAGE_BREAK.test(t)) continue;
    if (RE_GSTIN.test(t)) continue;
    // Courier may span two lines ("PREPAID\nCOURIER: DTDC Surface 20kg").
    // We just grab the COURIER: line; the operator can rename in UI.
    const cm = t.match(RE_COURIER_LINE);
    if (cm) {
      courier = cm[1].trim();
      continue;
    }
    const im = t.match(RE_INVOICE_LINE);
    if (im) {
      extInvoiceNo = im[1].trim();
      invoiceDate = im[2].trim();
      inItemSection = false;
      continue;
    }
    const tm = t.match(RE_TOTAL_LINE);
    if (tm) {
      totalUnits = parseInt(tm[1], 10);
      grandTotal = parseFloat(tm[2].replace(/,/g, ""));
      continue;
    }
    if (!inItemSection) continue;
    // ITEM CODE line
    const m = t.match(RE_ITEM_CODE_START);
    if (m) {
      const { description, qty, rate, note } = splitItemBody(m[2]);
      items.push({
        externalCode: m[1],
        description,
        qty,
        rate,
        rawLine: t,
        ...(note ? { note } : {}),
      });
    } else {
      unparsedItemLines.push(t);
    }
  }

  return {
    channelHint: courier ? courier.split(/\s+/)[0] : null,
    customer,
    shipping: {
      awb,
      externalOrderNo: extOrder,
      courier,
    },
    invoice: {
      externalInvoiceNo: extInvoiceNo,
      invoiceDate,
    },
    totals: {
      totalUnits,
      grandTotal,
    },
    items,
    rawText,
    unparsedItemLines,
  };
};
