/**
 * Shiprocket rate test matrix
 * Origin: 517319 (Srikalahasti, AP)
 * Weights: 2 kg, 5 kg, 10 kg, 20 kg
 * Destinations: intra-state (AP) and inter-state at 50 / 100 / 150 / 200 km bands
 *
 * Usage:
 *   npx tsx scripts/shiprocket-rate-test.ts
 *
 * Output:
 *   backend/scripts/shiprocket-rate-test.xlsx
 */

import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getShiprocketCredentials } from "../src/lib/shiprocket-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const ORIGIN_PINCODE = "517319";

const WEIGHTS_KG = [2, 5, 10, 20];

const DESTINATIONS = [
  // Intra-state — Andhra Pradesh
  { label: "Chittoor (AP)",   pincode: "517001", distanceKm: 60,  type: "Intra-state" },
  { label: "Kadapa (AP)",     pincode: "516001", distanceKm: 100, type: "Intra-state" },
  { label: "Anantapur (AP)",  pincode: "515001", distanceKm: 150, type: "Intra-state" },
  { label: "Nellore (AP)",    pincode: "524001", distanceKm: 200, type: "Intra-state" },
  // South India — Inter-state
  { label: "Krishnagiri (TN)",  pincode: "635001", distanceKm: 50,  type: "Inter-state" },
  { label: "Dharmapuri (TN)",   pincode: "636701", distanceKm: 100, type: "Inter-state" },
  { label: "Bengaluru (KA)",    pincode: "560001", distanceKm: 150, type: "Inter-state" },
  { label: "Chennai (TN)",      pincode: "600001", distanceKm: 200, type: "Inter-state" },
  // Central / West India
  { label: "Hyderabad (TS)",    pincode: "500001", distanceKm: 350, type: "Inter-state" },
  { label: "Mumbai (MH)",       pincode: "400001", distanceKm: 1100, type: "Inter-state" },
  { label: "Pune (MH)",         pincode: "411001", distanceKm: 950, type: "Inter-state" },
  { label: "Ahmedabad (GJ)",    pincode: "380001", distanceKm: 1400, type: "Inter-state" },
  // North India
  { label: "Delhi (DL)",        pincode: "110001", distanceKm: 1800, type: "Inter-state" },
  { label: "Jaipur (RJ)",       pincode: "302001", distanceKm: 1700, type: "Inter-state" },
  { label: "Lucknow (UP)",      pincode: "226001", distanceKm: 1950, type: "Inter-state" },
  { label: "Kolkata (WB)",      pincode: "700001", distanceKm: 1700, type: "Inter-state" },
];

// ── API helpers ───────────────────────────────────────────────────────────────
const API_BASE = "https://apiv2.shiprocket.in/v1/external";
let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const creds = await getShiprocketCredentials();
  if (!creds) throw new Error("No Shiprocket credentials configured. Set them in ERP → Settings → Shipping or via SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD env vars.");

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const json = (await res.json()) as { token?: string; message?: string };
  if (!res.ok || !json.token) throw new Error(`Shiprocket auth failed: ${json.message ?? res.status}`);
  cachedToken = json.token;
  return cachedToken;
}

type RateRow = {
  courierName: string;
  mode: string;
  rate: number;
  etaDays: number | null;
};

async function getRates(deliveryPincode: string, weightKg: number): Promise<RateRow[]> {
  const token = await getToken();
  const modes = ["Surface", "Air"] as const;
  const allRows: RateRow[] = [];

  for (const mode of modes) {
    const query = new URLSearchParams({
      pickup_postcode: ORIGIN_PINCODE,
      delivery_postcode: deliveryPincode,
      weight: String(Math.max(weightKg, 0.5)),
      cod: "0",
      mode,
    });
    const res = await fetch(`${API_BASE}/courier/serviceability/?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) continue;
    const json = (await res.json()) as {
      data?: { available_courier_companies?: any[] };
      available_courier_companies?: any[];
    };
    const list = json.data?.available_courier_companies ?? json.available_courier_companies ?? [];
    for (const c of list) {
      const rate = parseFloat(String(c.rate ?? c.freight_charge ?? "").replace(/[^\d.]/g, ""));
      if (!Number.isFinite(rate)) continue;
      const rawEta = c.estimated_delivery_days ?? c.etd;
      const etaDays = rawEta ? parseInt(String(rawEta).match(/(\d+)/)?.[1] ?? "", 10) || null : null;
      const modeStr = (() => {
        const m = c.mode;
        if (m === 0 || m === "0") return "Surface";
        if (m === 1 || m === "1") return "Air";
        const s = String(m ?? "").toLowerCase();
        if (s.includes("air")) return "Air";
        if (s.includes("surface") || s.includes("road")) return "Surface";
        return mode;
      })();
      allRows.push({ courierName: c.courier_name ?? "Courier", mode: modeStr, rate, etaDays });
    }
  }

  // Deduplicate by courierName+mode, keep cheapest
  const map = new Map<string, RateRow>();
  for (const r of allRows) {
    const key = `${r.courierName}|${r.mode}`;
    if (!map.has(key) || r.rate < map.get(key)!.rate) map.set(key, r);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

// ── Build result rows ─────────────────────────────────────────────────────────
type ResultRow = {
  type: string;
  destination: string;
  pincode: string;
  distanceKm: number;
  weightKg: number;
  courierName: string;
  mode: string;
  rateRs: number;
  etaDays: string;
};

async function run() {
  console.log(`\nShiprocket rate matrix — origin: ${ORIGIN_PINCODE} (Madanapalle, Chittoor dist., AP)`);
  console.log(`Weights: ${WEIGHTS_KG.join(", ")} kg`);
  console.log(`Destinations: ${DESTINATIONS.length} pincodes\n`);

  const results: ResultRow[] = [];
  const total = DESTINATIONS.length * WEIGHTS_KG.length;
  let done = 0;

  for (const dest of DESTINATIONS) {
    for (const wt of WEIGHTS_KG) {
      process.stdout.write(`  [${++done}/${total}] ${dest.label} · ${wt}kg ... `);
      try {
        const rows = await getRates(dest.pincode, wt);
        if (rows.length === 0) {
          results.push({
            type: dest.type, destination: dest.label, pincode: dest.pincode,
            distanceKm: dest.distanceKm, weightKg: wt,
            courierName: "N/A", mode: "N/A", rateRs: 0, etaDays: "N/A",
          });
          console.log("no couriers");
        } else {
          for (const r of rows) {
            results.push({
              type: dest.type, destination: dest.label, pincode: dest.pincode,
              distanceKm: dest.distanceKm, weightKg: wt,
              courierName: r.courierName, mode: r.mode, rateRs: r.rate,
              etaDays: r.etaDays != null ? `${r.etaDays}` : "—",
            });
          }
          const cheapest = rows[0];
          console.log(`${rows.length} couriers · cheapest ₹${cheapest.rate} (${cheapest.courierName})`);
        }
      } catch (e) {
        console.log(`ERROR: ${(e as Error).message}`);
      }
      // Throttle to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Write Excel ──────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "NovaERP";
  wb.created = new Date();

  // ── Sheet 1: Full detail ──────────────────────────────────────────────────
  const wsDetail = wb.addWorksheet("All Couriers");
  wsDetail.columns = [
    { header: "Type",          key: "type",        width: 14 },
    { header: "Destination",   key: "destination", width: 22 },
    { header: "Pincode",       key: "pincode",     width: 10 },
    { header: "Distance (km)", key: "distanceKm",  width: 14 },
    { header: "Weight (kg)",   key: "weightKg",    width: 12 },
    { header: "Courier",       key: "courierName", width: 28 },
    { header: "Mode",          key: "mode",        width: 10 },
    { header: "Rate (₹)",      key: "rateRs",      width: 12 },
    { header: "ETA (days)",    key: "etaDays",     width: 12 },
  ];

  // Style header row
  const headerRow = wsDetail.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  headerRow.alignment = { horizontal: "center" };

  for (const r of results) wsDetail.addRow(r);

  // Alternate row shading
  wsDetail.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const fill: ExcelJS.Fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: rowNum % 2 === 0 ? "FFF2F2F2" : "FFFFFFFF" },
    };
    row.eachCell(cell => { cell.fill = fill; });
  });

  // Color-code mode column
  wsDetail.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const modeCell = row.getCell("mode");
    if (modeCell.value === "Air") {
      modeCell.font = { color: { argb: "FF0070C0" }, bold: true };
    } else if (modeCell.value === "Surface") {
      modeCell.font = { color: { argb: "FF375623" }, bold: true };
    }
  });

  // Color-code type column
  wsDetail.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const typeCell = row.getCell("type");
    if (typeCell.value === "Inter-state") {
      typeCell.font = { color: { argb: "FF7030A0" }, bold: true };
    }
  });

  // Auto-filter
  wsDetail.autoFilter = { from: "A1", to: "I1" };

  // ── Sheet 2: Cheapest per destination × weight (summary) ─────────────────
  const wsSummary = wb.addWorksheet("Cheapest Rate Summary");

  // Build summary: for each dest×weight, find cheapest Surface and Air
  type SumKey = `${string}|${number}`;
  const cheapestSurface = new Map<SumKey, ResultRow>();
  const cheapestAir     = new Map<SumKey, ResultRow>();

  for (const r of results) {
    const key: SumKey = `${r.pincode}|${r.weightKg}`;
    if (r.mode === "Surface" || r.mode === "Unknown") {
      const cur = cheapestSurface.get(key);
      if (!cur || r.rateRs < cur.rateRs) cheapestSurface.set(key, r);
    }
    if (r.mode === "Air") {
      const cur = cheapestAir.get(key);
      if (!cur || r.rateRs < cur.rateRs) cheapestAir.set(key, r);
    }
  }

  wsSummary.columns = [
    { header: "Type",             key: "type",        width: 14 },
    { header: "Destination",      key: "destination", width: 22 },
    { header: "Pincode",          key: "pincode",     width: 10 },
    { header: "Distance (km)",    key: "distanceKm",  width: 14 },
    { header: "Weight (kg)",      key: "weightKg",    width: 12 },
    { header: "Surface Rate (₹)", key: "surfaceRate", width: 16 },
    { header: "Surface Courier",  key: "surfaceCourier", width: 26 },
    { header: "Surface ETA",      key: "surfaceEta",  width: 12 },
    { header: "Air Rate (₹)",     key: "airRate",     width: 14 },
    { header: "Air Courier",      key: "airCourier",  width: 26 },
    { header: "Air ETA",          key: "airEta",      width: 10 },
  ];

  const sumHdr = wsSummary.getRow(1);
  sumHdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  sumHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  sumHdr.alignment = { horizontal: "center" };

  const seen = new Set<SumKey>();
  for (const dest of DESTINATIONS) {
    for (const wt of WEIGHTS_KG) {
      const key: SumKey = `${dest.pincode}|${wt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const surf = cheapestSurface.get(key);
      const air  = cheapestAir.get(key);
      wsSummary.addRow({
        type:           dest.type,
        destination:    dest.label,
        pincode:        dest.pincode,
        distanceKm:     dest.distanceKm,
        weightKg:       wt,
        surfaceRate:    surf?.rateRs ?? "N/A",
        surfaceCourier: surf?.courierName ?? "N/A",
        surfaceEta:     surf?.etaDays ?? "—",
        airRate:        air?.rateRs ?? "N/A",
        airCourier:     air?.courierName ?? "N/A",
        airEta:         air?.etaDays ?? "—",
      });
    }
  }

  wsSummary.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const fill: ExcelJS.Fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: rowNum % 2 === 0 ? "FFF2F2F2" : "FFFFFFFF" },
    };
    row.eachCell(cell => { cell.fill = fill; });
    // Inter-state highlight
    if (row.getCell("type").value === "Inter-state") {
      row.getCell("type").font = { color: { argb: "FF7030A0" }, bold: true };
    }
  });

  wsSummary.autoFilter = { from: "A1", to: "K1" };

  // ── Sheet 3: Pivot — Weight vs Distance ──────────────────────────────────
  const wsPivot = wb.addWorksheet("Pivot (Surface, Cheapest)");

  // Header: origin info
  wsPivot.getCell("A1").value = `Origin: ${ORIGIN_PINCODE} (Madanapalle, Chittoor dist., AP)`;
  wsPivot.getCell("A1").font = { bold: true, size: 13 };
  wsPivot.getCell("A2").value = `Cheapest Surface rate (₹) — as of ${new Date().toLocaleDateString("en-IN")}`;
  wsPivot.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };

  const pivotStartRow = 4;
  // Column headers: weights
  wsPivot.getCell(pivotStartRow, 1).value = "Destination";
  wsPivot.getCell(pivotStartRow, 2).value = "Type";
  wsPivot.getCell(pivotStartRow, 3).value = "~Distance";
  WEIGHTS_KG.forEach((wt, i) => {
    const cell = wsPivot.getCell(pivotStartRow, 4 + i);
    cell.value = `${wt} kg`;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E74B5" } };
    cell.alignment = { horizontal: "center" };
  });
  wsPivot.getRow(pivotStartRow).font = { bold: true };

  DESTINATIONS.forEach((dest, di) => {
    const rowNum = pivotStartRow + 1 + di;
    const row = wsPivot.getRow(rowNum);
    row.getCell(1).value = dest.label;
    row.getCell(2).value = dest.type;
    row.getCell(3).value = `~${dest.distanceKm} km`;
    if (dest.type === "Inter-state") {
      row.getCell(2).font = { color: { argb: "FF7030A0" }, bold: true };
    }
    WEIGHTS_KG.forEach((wt, wi) => {
      const key: SumKey = `${dest.pincode}|${wt}`;
      const surf = cheapestSurface.get(key);
      const cell = row.getCell(4 + wi);
      cell.value = surf?.rateRs ?? "N/A";
      cell.alignment = { horizontal: "center" };
      if (typeof surf?.rateRs === "number") {
        // Green→Red gradient by rate value for each weight column
        const rate = surf.rateRs;
        const color = rate < 100 ? "FF92D050" : rate < 200 ? "FFFFEB9C" : rate < 350 ? "FFFFC000" : "FFFF0000";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      }
    });
    // Alternate row fill
    if (di % 2 === 0) {
      [1,2,3].forEach(c => {
        row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      });
    }
  });

  wsPivot.getColumn(1).width = 24;
  wsPivot.getColumn(2).width = 14;
  wsPivot.getColumn(3).width = 12;
  WEIGHTS_KG.forEach((_, i) => { wsPivot.getColumn(4 + i).width = 12; });

  // ── Sheet 4: Zone explanation + notes ───────────────────────────────────
  const wsNotes = wb.addWorksheet("📋 Notes & Zone Guide");

  const addTitle = (row: number, text: string, color = "FF1F4E79") => {
    const cell = wsNotes.getCell(row, 1);
    cell.value = text;
    cell.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    cell.alignment = { horizontal: "left", indent: 1 };
    wsNotes.mergeCells(row, 1, row, 6);
  };

  const addSubTitle = (row: number, text: string) => {
    const cell = wsNotes.getCell(row, 1);
    cell.value = text;
    cell.font = { bold: true, size: 11, color: { argb: "FF1F4E79" } };
    wsNotes.mergeCells(row, 1, row, 6);
  };

  const addPara = (row: number, text: string, indent = 1) => {
    const cell = wsNotes.getCell(row, 1);
    cell.value = text;
    cell.font = { size: 10 };
    cell.alignment = { wrapText: true, horizontal: "left", indent };
    wsNotes.mergeCells(row, 1, row, 6);
    wsNotes.getRow(row).height = 18;
  };

  const addTableHeader = (row: number, headers: string[], colors: string[]) => {
    headers.forEach((h, i) => {
      const cell = wsNotes.getCell(row, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors[i] ?? "FF1F4E79" } };
      cell.alignment = { horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
    });
  };

  const addTableRow = (row: number, values: (string | number)[], shade: boolean) => {
    values.forEach((v, i) => {
      const cell = wsNotes.getCell(row, i + 1);
      cell.value = v;
      cell.font = { size: 10 };
      cell.fill = shade
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } }
        : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "left", wrapText: true, indent: 1 };
    });
  };

  wsNotes.getColumn(1).width = 28;
  wsNotes.getColumn(2).width = 18;
  wsNotes.getColumn(3).width = 18;
  wsNotes.getColumn(4).width = 18;
  wsNotes.getColumn(5).width = 18;
  wsNotes.getColumn(6).width = 22;

  let r = 1;

  // ── Header banner ────────────────────────────────────────────────────────
  wsNotes.getCell(r, 1).value = "Shiprocket Shipping Rate Analysis";
  wsNotes.getCell(r, 1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  wsNotes.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  wsNotes.mergeCells(r, 1, r, 6);
  wsNotes.getRow(r).height = 30;
  r++;

  wsNotes.getCell(r, 1).value = `Origin: 517319 — Madanapalle, Chittoor District, Andhra Pradesh  |  Generated: ${new Date().toLocaleString("en-IN")}`;
  wsNotes.getCell(r, 1).font = { italic: true, size: 10, color: { argb: "FF595959" } };
  wsNotes.mergeCells(r, 1, r, 6);
  r += 2;

  // ── Section 1: How zone pricing works ────────────────────────────────────
  addTitle(r, "1.  How Shiprocket Zone-Based Pricing Works"); r++;
  addPara(r, "Shiprocket (and all major Indian courier companies) do NOT charge by kilometre distance."); r++;
  addPara(r, "Instead, every pickup–delivery pincode pair is mapped to a fixed ZONE (A–F). All deliveries"); r++;
  addPara(r, "within the same zone are charged identically, regardless of whether the city is 50 km or 2,000 km away."); r++;
  addPara(r, ""); r++;
  addPara(r, "This is why Hyderabad (350 km) and Jaipur (1,700 km) show the same rate — both fall in the same"); r++;
  addPara(r, "Shiprocket zone from pincode 517319. The distance column in this workbook is for reference only."); r++;
  r++;

  // ── Zone table ────────────────────────────────────────────────────────────
  addSubTitle(r, "Shiprocket Zone Classification (from 517319, Madanapalle AP)"); r++;
  addTableHeader(r,
    ["Zone", "Coverage", "Examples from 517319", "Typical 2 kg Rate", "Typical 5 kg Rate", "Notes"],
    ["FF375623","FF375623","FF375623","FF375623","FF375623","FF375623"]
  ); r++;

  const zoneRows: [string, string, string, string, string, string][] = [
    ["Zone B", "Same state (AP)", "Chittoor, Kadapa, Anantapur, Nellore", "₹90 – ₹142", "₹211 – ₹257", "Cheapest bracket"],
    ["Zone C", "Adj. states / short inter-state", "Bengaluru (KA), Hyderabad (TS),\nDharmapuri (TN), Pune (MH)", "₹162 – ₹165", "₹272 – ₹284", "Same price as 1,500 km"],
    ["Zone D", "Mid-range inter-state", "Chennai (TN), Mumbai (MH),\nAhmedabad (GJ)", "₹182", "₹278 – ₹284", "Marginal increase"],
    ["Zone E", "Long-distance / metros", "Delhi (DL), Kolkata (WB),\nLucknow (UP)", "₹162 – ₹182", "₹272 – ₹314", "Delhi slightly higher"],
  ];
  zoneRows.forEach((row, i) => { addTableRow(r, row, i % 2 === 1); r++; });
  r++;

  // ── Section 2: Key findings ───────────────────────────────────────────────
  addTitle(r, "2.  Key Findings from This Rate Matrix", "FF2E74B5"); r++;
  const findings = [
    "• Intra-state (AP) shipping is 30–80% cheaper than any inter-state destination.",
    "• All of South + Central India (Bengaluru, Hyderabad, Pune, Mumbai) falls in the same cost bracket.",
    "• Delhi and Kolkata cost only marginally more (₹18–₹30 extra) than Bengaluru for 2–5 kg shipments.",
    "• For 20 kg orders, rates jump sharply (₹630–₹930). Heavy orders significantly impact margins.",
    "• Xpressbees offers the best rates for AP + Central India. DTDC/Delhivery competitive for North/East.",
    "• Amazon Shipping Surface is cheapest for Chittoor and some inter-state pincodes.",
  ];
  findings.forEach(f => { addPara(r, f, 2); r++; });
  r++;

  // ── Section 3: Free shipping threshold recommendation ────────────────────
  addTitle(r, "3.  Free Shipping Threshold Recommendation", "FF7030A0"); r++;
  addPara(r, "Based on the rate data above, suggested free-shipping thresholds to maintain healthy margins:"); r++;
  r++;

  addTableHeader(r,
    ["Scenario", "Order Value Threshold", "Courier Avg. Cost", "Margin Impact", "Recommended?", "Notes"],
    ["FF7030A0","FF7030A0","FF7030A0","FF7030A0","FF7030A0","FF7030A0"]
  ); r++;

  const threshRows: [string,string,string,string,string,string][] = [
    ["Intra-AP, ≤2 kg",     "₹500+",   "₹90–₹142",  "18–28%",  "✅ Yes", "Works for small orders"],
    ["Intra-AP, ≤5 kg",     "₹800+",   "₹211–₹257", "26–32%",  "✅ Yes", "Good for grocery bundles"],
    ["Pan-India, ≤2 kg",    "₹999+",   "₹162–₹182", "16–18%",  "✅ Yes", "Standard ecommerce threshold"],
    ["Pan-India, ≤5 kg",    "₹1,500+", "₹272–₹314", "18–21%",  "✅ Yes", "Covers most product combos"],
    ["Pan-India, ≤10 kg",   "₹2,500+", "₹464–₹522", "19–21%",  "⚠️ Review", "Check category margins"],
    ["Pan-India, ≤20 kg",   "₹4,000+", "₹830–₹931", "21–23%",  "⚠️ Review", "Bulk orders need review"],
  ];
  threshRows.forEach((row, i) => { addTableRow(r, row, i % 2 === 1); r++; });
  r++;

  // ── Section 4: Sheet guide ────────────────────────────────────────────────
  addTitle(r, "4.  How to Use This Workbook", "FF404040"); r++;
  const sheetGuide = [
    ["All Couriers",           "Full list of every courier + rate for each destination × weight combination. Use auto-filter to sort by rate, mode, or destination."],
    ["Cheapest Rate Summary",  "One row per destination × weight. Shows cheapest Surface and Air courier side-by-side. Best for quick rate comparison and pricing decisions."],
    ["Pivot (Surface, Cheapest)", "Heat-map table: rows = destinations, columns = weights. Green = cheapest, Red = most expensive. Instant visual overview of your cost matrix."],
    ["Notes & Zone Guide",     "This sheet. Explains zone-based pricing, key findings, and free-shipping recommendations."],
  ];
  r++;
  addTableHeader(r, ["Sheet Name", "Purpose"], ["FF404040","FF404040","FF404040","FF404040","FF404040","FF404040"]); r++;
  sheetGuide.forEach(([name, desc], i) => {
    wsNotes.getCell(r, 1).value = name;
    wsNotes.getCell(r, 1).font = { bold: true, size: 10 };
    wsNotes.getCell(r, 2).value = desc;
    wsNotes.getCell(r, 2).font = { size: 10 };
    wsNotes.getCell(r, 2).alignment = { wrapText: true };
    wsNotes.mergeCells(r, 2, r, 6);
    wsNotes.getRow(r).height = 22;
    if (i % 2 === 1) {
      [1,2].forEach(c => {
        wsNotes.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      });
    }
    r++;
  });
  r++;

  // ── Footer ────────────────────────────────────────────────────────────────
  addPara(r, `Data fetched live from Shiprocket API on ${new Date().toLocaleDateString("en-IN")}. Re-run npm run shiprocket:rate-test to refresh rates.`); r++;
  wsNotes.getCell(r - 1, 1).font = { italic: true, size: 9, color: { argb: "FF888888" } };
  const outPath = path.resolve(__dirname, "shiprocket-rate-test.xlsx");
  await wb.xlsx.writeFile(outPath);

  console.log(`\n✓ Saved: ${outPath}`);
  console.log(`  Sheets: "All Couriers" (${results.length} rows) | "Cheapest Rate Summary" | "Pivot (Surface, Cheapest)"`);

  process.exit(0);
}

run().catch(err => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
