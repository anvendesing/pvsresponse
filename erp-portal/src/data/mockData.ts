import type {
  Bin,
  Bom,
  DispatchOrder,
  Invoice,
  ProductionOrder,
  Product,
  PurchaseOrder,
  StockLedgerEntry,
  Vendor,
  WorkOrder,
  Worker,
} from "./types";

const seed = (i: number) => ((i * 9301 + 49297) % 233280) / 233280;
const pick = <T,>(arr: readonly T[], i: number): T => arr[Math.floor(seed(i + 7) * arr.length)];

const productNames = [
  "Steel Coil 2mm",
  "Aluminum Sheet 1.5mm",
  "Copper Wire 1.5sqmm",
  "PVC Pipe 4 inch",
  "MS Plate 6mm",
  "Welding Rod E6013",
  "Hex Bolt M10x40",
  "Hex Nut M10",
  "Washer M10",
  "Bearing 6205",
  "Motor 1HP 3-Phase",
  "Capacitor 50uF",
  "Power Cable 4mm",
  "Steel Rod 12mm",
  "Solenoid Valve 1/2\"",
  "Gear Pump 0.5HP",
  "Pressure Switch",
  "Hydraulic Hose 8mm",
  "Rubber Gasket 4 inch",
  "Limit Switch",
  "Servo Motor 400W",
  "PLC Module 16I/O",
  "Contactor 9A",
  "MCB 32A 4-Pole",
  "Pneumatic Cylinder",
  "Frame Assembly A1",
  "Drive Shaft 200mm",
  "Casting Block 20kg",
  "Rotor Sub-Assembly",
  "Painted Cabinet",
  "Finished Pump A2",
  "Finished Motor M3",
];

const vendorNames = [
  "Steelworks Industries",
  "Apex Components Pvt Ltd",
  "Bharat Electricals",
  "Quantum Auto Parts",
  "Deccan Casting Co",
  "Nimbus Hydraulics",
  "Vikas Bearing House",
  "Orion Polymers",
  "Metro Hardware",
  "Perfect Engineering",
];

const customers = [
  "Hindustan Motors Ltd",
  "ABC Engineering",
  "Mahindra Logistics",
  "Tata AutoComp",
  "Bosch India",
  "Ashok Leyland",
  "Bajaj Auto",
  "TVS Group",
  "Bharat Forge",
  "Larsen Toubro",
];

const cities = ["Pune", "Chennai", "Mumbai", "Bangalore", "Hyderabad", "Coimbatore", "Delhi"];
const drivers = ["Ramesh K", "Suresh M", "Pankaj S", "Vinod R", "Mohan T", "Imran S"];

export const products: Product[] = productNames.map((name, i) => {
  const types: Product["type"][] = ["raw", "semi", "finished", "consumable"];
  const type = i < 18 ? "raw" : i < 25 ? "consumable" : i < 30 ? "semi" : "finished";
  const cost = Math.round(50 + seed(i) * 4000);
  return {
    id: `P${String(i + 1).padStart(4, "0")}`,
    sku: `${type === "raw" ? "RM" : type === "semi" ? "SF" : type === "finished" ? "FG" : "CN"}-${String(i + 1).padStart(4, "0")}`,
    name,
    type,
    uom: ["PCS", "KG", "MTR", "BOX"][i % 4],
    barcode: `8901234${String(100000 + i).slice(-6)}`,
    state: i % 17 === 0 ? "blocked" : "active",
    stockOnHand: Math.round(20 + seed(i) * 2000),
    reorderLevel: Math.round(50 + seed(i + 1) * 200),
    costPrice: cost,
    sellingPrice: Math.round(cost * (1.25 + seed(i + 2) * 0.4)),
    category: ["Metals", "Electrical", "Mechanical", "Polymers", "Assemblies"][i % 5],
    hsn: `7${String(2000 + i).slice(-4)}`,
    batchTracked: i % 3 === 0,
  };
});

export const vendors: Vendor[] = vendorNames.map((name, i) => ({
  id: `V${String(i + 1).padStart(3, "0")}`,
  code: `VEND-${String(i + 1).padStart(4, "0")}`,
  name,
  gst: `27ABCDE${String(1000 + i)}F1Z${i % 9}`,
  contact: `+91 9${String(800000000 + i * 73219).slice(-9)}`,
  email: null,
  address: null,
  paymentTerms: null,
  rating: Math.round((3 + seed(i + 4) * 2) * 10) / 10,
  leadTimeDays: 3 + Math.floor(seed(i + 5) * 14),
  city: pick(cities, i),
  active: true,
  outstandingPO: Math.floor(seed(i + 6) * 8),
  totalSpend: Math.round(500000 + seed(i + 7) * 12000000),
}));

export const purchaseOrders: PurchaseOrder[] = Array.from({ length: 24 }, (_, i) => {
  const v = pick(vendors, i);
  const status = pick(["draft", "approved", "partial", "received", "closed"] as const, i + 1);
  const date = new Date(Date.now() - i * 86400000 * (1 + seed(i)) * 0.7);
  return {
    id: `POR${String(i + 1).padStart(4, "0")}`,
    poNo: `PO-2026-${String(1100 + i)}`,
    vendor: v.name,
    vendorId: v.id,
    date: date.toISOString(),
    expectedDate: new Date(date.getTime() + 86400000 * v.leadTimeDays).toISOString(),
    status,
    amount: Math.round(50000 + seed(i + 9) * 1500000),
    itemCount: 2 + Math.floor(seed(i + 10) * 12),
    receivedPct:
      status === "received" || status === "closed"
        ? 100
        : status === "partial"
          ? Math.floor(seed(i + 11) * 80) + 10
          : 0,
  };
});

export const productionOrders: ProductionOrder[] = Array.from({ length: 18 }, (_, i) => {
  const fg = products.filter((p) => p.type === "finished" || p.type === "semi");
  const p = fg[i % fg.length];
  const planned = 100 + Math.floor(seed(i + 12) * 800);
  const status = pick(
    ["planned", "in-progress", "in-progress", "in-progress", "qc", "completed", "delayed"] as const,
    i
  );
  const actual =
    status === "completed"
      ? planned
      : status === "in-progress" || status === "qc"
        ? Math.floor(planned * (0.3 + seed(i + 13) * 0.6))
        : status === "delayed"
          ? Math.floor(planned * 0.4)
          : 0;
  const startDate = new Date(Date.now() - (i + 1) * 86400000 * 0.8);
  return {
    id: `MO${String(i + 1).padStart(4, "0")}`,
    orderNo: `MO-2026-${String(2200 + i)}`,
    product: p.name,
    sku: p.sku,
    plannedQty: planned,
    actualQty: actual,
    scrapQty: Math.floor(actual * 0.02),
    reworkQty: Math.floor(actual * 0.01),
    status,
    station: `Line-${(i % 4) + 1}`,
    startDate: startDate.toISOString(),
    dueDate: new Date(startDate.getTime() + 86400000 * 5).toISOString(),
    efficiency: Math.round((75 + seed(i + 15) * 22) * 10) / 10,
  };
});

export const workOrders: WorkOrder[] = productionOrders.flatMap((po, i) => {
  const stages = ["Cutting", "Welding", "Assembly", "QC", "Pack"];
  return stages.slice(0, 3 + (i % 3)).map((stage, j) => ({
    id: `WO${po.id}-${j + 1}`,
    workOrderNo: `${po.orderNo}/${j + 1}`,
    productionOrderId: po.id,
    station: stage,
    workers: [`Worker ${(i * 3 + j) % 12 + 1}`],
    machine: `M-${stage.slice(0, 2).toUpperCase()}-${(j % 4) + 1}`,
    startTime: new Date(Date.now() - (5 - j) * 3600000).toISOString(),
    endTime: j < 2 ? new Date(Date.now() - (4 - j) * 3600000).toISOString() : undefined,
    output: Math.floor(seed(i + j + 17) * 200) + 40,
    target: 200,
    status: pick(["queued", "running", "running", "paused", "complete"] as const, i + j),
  }));
});

const workerNames = [
  "Rajesh Kumar",
  "Suresh Patel",
  "Mahesh Singh",
  "Ramesh Sharma",
  "Anil Yadav",
  "Vijay Mehta",
  "Pankaj Shah",
  "Mohan Reddy",
  "Vinod Joshi",
  "Imran Khan",
  "Karan Verma",
  "Deepak Rao",
  "Ashok Iyer",
  "Naveen Pillai",
  "Manoj Das",
];

export const workers: Worker[] = workerNames.map((name, i) => {
  const target = 240;
  const units = Math.floor(target * (0.6 + seed(i + 19) * 0.5));
  return {
    id: `W${String(i + 1).padStart(4, "0")}`,
    empNo: `EMP${String(1001 + i)}`,
    name,
    station: `Line-${(i % 4) + 1}`,
    shift: (["A", "B", "C"] as const)[i % 3],
    status: i % 7 === 0 ? "break" : i % 13 === 0 ? "out" : "in",
    unitsToday: units,
    targetToday: target,
    efficiency: Math.round((units / target) * 1000) / 10,
    rejectionRate: Math.round(seed(i + 20) * 30) / 10,
    hoursToday: 5 + seed(i + 21) * 3,
  };
});

const warehouses = ["WH-MAIN", "WH-RAW", "WH-FG"];
const zones = ["A", "B", "C"];
export const bins: Bin[] = [];
for (let w = 0; w < warehouses.length; w++) {
  for (let z = 0; z < zones.length; z++) {
    for (let r = 1; r <= 4; r++) {
      for (let s = 1; s <= 3; s++) {
        for (let b = 1; b <= 4; b++) {
          const idx = bins.length;
          const has = idx % 4 !== 0;
          const product = has ? products[idx % products.length] : undefined;
          bins.push({
            id: `${warehouses[w]}-${zones[z]}-${r}-${s}-${b}`,
            warehouse: warehouses[w],
            zone: zones[z],
            rack: `R${r}`,
            shelf: `S${s}`,
            bin: `B${b}`,
            capacity: 100,
            occupied: has ? Math.floor(seed(idx) * 100) : 0,
            productSku: product?.sku,
            productName: product?.name,
            qty: has ? Math.floor(seed(idx + 22) * 90 + 5) : undefined,
            batch: has && product?.batchTracked ? `BT-${String(2000 + (idx % 100))}` : undefined,
          });
        }
      }
    }
  }
}

export const invoices: Invoice[] = Array.from({ length: 28 }, (_, i) => {
  const status = pick(
    ["paid", "paid", "paid", "issued", "partial", "overdue", "draft"] as const,
    i
  );
  const amt = Math.round(8000 + seed(i + 23) * 500000);
  return {
    id: `INV${String(i + 1).padStart(5, "0")}`,
    invoiceNo: `INV-2026-${String(5500 + i)}`,
    customer: pick(customers, i),
    date: new Date(Date.now() - i * 86400000 * 0.5).toISOString(),
    amount: amt,
    tax: Math.round(amt * 0.18),
    status,
    paymentMode: pick(["cash", "card", "upi", "credit", "split"] as const, i + 2),
    itemCount: 1 + Math.floor(seed(i + 24) * 8),
  };
});

export const dispatchOrders: DispatchOrder[] = Array.from({ length: 14 }, (_, i) => ({
  id: `DSP${String(i + 1).padStart(4, "0")}`,
  dispatchNo: `DSP-2026-${String(3300 + i)}`,
  invoice: invoices[i % invoices.length].invoiceNo,
  vehicle: `MH-12-${String(1000 + i * 73).slice(-4)}`,
  driver: pick(drivers, i),
  destination: pick(cities, i),
  status: pick(
    ["planned", "loading", "in-transit", "in-transit", "delivered", "delayed"] as const,
    i
  ),
  etaHours: Math.round(seed(i + 25) * 36 + 2),
  weightKg: Math.round(200 + seed(i + 26) * 4000),
}));

export const boms: Bom[] = products
  .filter((p) => p.type === "finished" || p.type === "semi")
  .slice(0, 6)
  .map((p, i) => ({
    id: `BOM${String(i + 1).padStart(3, "0")}`,
    product: p.name,
    sku: p.sku,
    revision: `Rev-${i + 1}.0`,
    outputQty: 1,
    active: true,
    items: products
      .filter((c) => c.type === "raw" || c.type === "consumable")
      .slice(i * 2, i * 2 + 5)
      .map((c) => ({
        sku: c.sku,
        name: c.name,
        qty: Math.round((1 + seed(i) * 8) * 10) / 10,
        uom: c.uom,
        scrapPct: Math.round(seed(i + 27) * 50) / 10,
      })),
  }));

const txTypes: StockLedgerEntry["txnType"][] = [
  "GRN",
  "Issue",
  "Transfer",
  "Sale",
  "Production",
  "Adjust",
];
export const stockLedger: StockLedgerEntry[] = Array.from({ length: 60 }, (_, i) => {
  const p = products[i % products.length];
  const tx = pick(txTypes, i);
  const sign = tx === "GRN" || tx === "Production" ? 1 : tx === "Adjust" ? (i % 2 ? 1 : -1) : -1;
  const qty = sign * Math.floor(seed(i + 28) * 80 + 4);
  return {
    id: `LED${String(i + 1).padStart(5, "0")}`,
    date: new Date(Date.now() - i * 3600000 * 1.5).toISOString(),
    product: p.name,
    sku: p.sku,
    txnType: tx,
    ref:
      tx === "GRN"
        ? `GRN-${String(800 + i)}`
        : tx === "Sale"
          ? `INV-${String(5500 + i)}`
          : tx === "Production"
            ? `MO-2026-${String(2200 + i)}`
            : tx === "Transfer"
              ? `TRF-${String(400 + i)}`
              : `ADJ-${String(100 + i)}`,
    qty,
    warehouse: pick(warehouses, i),
    bin: `${pick(zones, i)}-${(i % 4) + 1}-${(i % 3) + 1}-${(i % 4) + 1}`,
    balance: p.stockOnHand + qty,
  };
});

// Time-series data for dashboards
export const salesTrend = Array.from({ length: 14 }, (_, i) => ({
  day: `D${i + 1}`,
  sales: Math.round(180000 + seed(i + 30) * 280000),
  cogs: Math.round(110000 + seed(i + 31) * 180000),
}));

export const productionTrend = Array.from({ length: 14 }, (_, i) => ({
  day: `D${i + 1}`,
  planned: Math.round(800 + seed(i + 32) * 400),
  actual: Math.round(700 + seed(i + 33) * 450),
  scrap: Math.round(15 + seed(i + 34) * 30),
}));

export const stationLoad = ["Line-1", "Line-2", "Line-3", "Line-4"].map((s, i) => ({
  station: s,
  output: Math.round(180 + seed(i + 35) * 220),
  target: 320,
  efficiency: Math.round(60 + seed(i + 36) * 35),
}));

export const procurementSplit = [
  { name: "Metals", value: 4200000 },
  { name: "Electrical", value: 2100000 },
  { name: "Mechanical", value: 1800000 },
  { name: "Polymers", value: 950000 },
  { name: "Consumables", value: 620000 },
];
