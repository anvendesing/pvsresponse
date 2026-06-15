import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const seed = (i: number) => ((i * 9301 + 49297) % 233280) / 233280;
const pick = <T>(arr: readonly T[], i: number): T => arr[Math.floor(seed(i + 7) * arr.length)];

async function main() {
  console.log("Seeding NovaERP database...");

  // ==================== Wipe ====================
  await db.changeLog.deleteMany();
  await db.tombstone.deleteMany();
  await db.syncState.deleteMany();
  await db.syncConflict.deleteMany();
  await db.auditLog.deleteMany();
  await db.approval.deleteMany();
  await db.dispatchOrder.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.deleteMany();
  // Fulfilment, sales and pricing
  await db.packingSlipItem.deleteMany();
  await db.packingSlip.deleteMany();
  await db.pickListItem.deleteMany();
  await db.pickList.deleteMany();
  await db.salesOrderItem.deleteMany();
  await db.salesOrder.deleteMany();
  await db.quoteRevision.deleteMany();
  await db.quoteItem.deleteMany();
  await db.quote.deleteMany();
  await db.priceListItem.deleteMany();
  await db.priceList.deleteMany();
  await db.attendance.deleteMany();
  await db.worker.deleteMany();
  await db.workOrder.deleteMany();
  await db.productionOrder.deleteMany();
  await db.bomItem.deleteMany();
  await db.bom.deleteMany();
  await db.grn.deleteMany();
  await db.purchaseOrderItem.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.stockLedger.deleteMany();
  await db.bin.deleteMany();
  await db.warehouse.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.vendor.deleteMany();
  await db.customer.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();

  // ==================== Users ====================
  const password = await bcrypt.hash("nova1234", 10);
  const pinHash = await bcrypt.hash("123456", 10);
  await db.user.createMany({
    data: [
      { username: "admin", name: "Admin User", role: "admin", passwordHash: password, pin: pinHash },
      { username: "arjun.patel", name: "Arjun Patel", role: "supervisor", passwordHash: password, pin: pinHash },
      { username: "warehouse1", name: "Naveen Pillai", role: "warehouse", passwordHash: password, pin: pinHash },
      { username: "billing1", name: "Karan Verma", role: "billing", passwordHash: password, pin: pinHash },
      { username: "procurement1", name: "Sandeep Kumar", role: "procurement", passwordHash: password, pin: pinHash },
    ],
  });
  console.log("✓ Users");

  // ==================== Warehouses ====================
  const whSpec = [
    { code: "WH-MAIN", name: "Main Warehouse", city: "Pune" },
    { code: "WH-RAW", name: "Raw Materials Yard", city: "Pune" },
    { code: "WH-FG", name: "Stock Room", city: "Pune" },
  ];
  for (const w of whSpec) await db.warehouse.create({ data: w });
  const warehouses = await db.warehouse.findMany();
  console.log("✓ Warehouses");

  // ==================== Products ====================
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
    'Solenoid Valve 1/2"',
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

  const defaultCat =
    (await db.productCategory.findUnique({ where: { slug: "grains" } })) ??
    (await db.productCategory.create({
      data: { slug: "grains", name: "Grains, Pulses & Flours", sortOrder: 2 },
    }));

  const products = await Promise.all(
    productNames.map((name, i) => {
      const t = i < 18 ? "raw" : i < 25 ? "consumable" : i < 30 ? "semi" : "finished";
      const cost = Math.round(50 + seed(i) * 4000);
      const prefix = t === "raw" ? "RM" : t === "semi" ? "SF" : t === "finished" ? "FG" : "CN";
      return db.product.create({
        data: {
          sku: `${prefix}-${String(i + 1).padStart(4, "0")}`,
          name,
          type: t,
          uom: ["PCS", "KG", "MTR", "BOX"][i % 4],
          barcode: `8901234${String(100000 + i).slice(-6)}`,
          state: i % 17 === 0 ? "blocked" : "active",
          stockOnHand: Math.round(20 + seed(i) * 2000),
          reorderLevel: Math.round(50 + seed(i + 1) * 200),
          costPrice: cost,
          sellingPrice: Math.round(cost * (1.25 + seed(i + 2) * 0.4)),
          categoryId: defaultCat.id,
          hsn: `7${String(2000 + i).slice(-4)}`,
          batchTracked: i % 3 === 0,
        },
      });
    })
  );
  console.log(`✓ Products (${products.length})`);

  // ==================== Variants ====================
  // Add a few size/color variants to demonstrate the feature.
  const sizes = ["S", "M", "L", "XL"];
  const colors = ["Red", "Blue", "Black", "Silver"];
  const grades = ["A", "B"];
  let variantCount = 0;
  // Sheets / plates: size + grade variants
  const sheetCandidates = products.filter(
    (p) => p.name.includes("Sheet") || p.name.includes("Plate") || p.name.includes("Coil")
  );
  for (const p of sheetCandidates) {
    for (let i = 0; i < 2; i++) {
      const grade = grades[i % grades.length];
      const size = sizes[i % sizes.length];
      const v = await db.productVariant.create({
        data: {
          productId: p.id,
          sku: `${p.sku}-${grade}-${size}`,
          barcode: `${p.barcode}${i}`,
          size,
          grade,
          stockOnHand: Math.round(20 + seed(variantCount + 100) * 200),
          sellingPriceOverride:
            Math.round(p.sellingPrice * (1 + (i === 0 ? 0 : 0.08))),
        },
      });
      variantCount++;
      void v;
    }
  }
  // Cabinets / motors: color variants
  const colorCandidates = products.filter(
    (p) => p.name.includes("Cabinet") || p.name.includes("Motor") || p.name.includes("Pump")
  );
  for (const p of colorCandidates) {
    for (let i = 0; i < 2; i++) {
      const color = colors[(i + variantCount) % colors.length];
      await db.productVariant.create({
        data: {
          productId: p.id,
          sku: `${p.sku}-${color.toUpperCase().slice(0, 3)}`,
          barcode: `${p.barcode}V${i}`,
          color,
          stockOnHand: Math.round(5 + seed(variantCount + 200) * 60),
        },
      });
      variantCount++;
    }
  }
  console.log(`✓ Variants (${variantCount})`);

  // ==================== Bins ====================
  const zones = ["A", "B", "C"];
  let binIdx = 0;
  for (const wh of warehouses) {
    for (const z of zones) {
      for (let r = 1; r <= 4; r++) {
        for (let s = 1; s <= 3; s++) {
          for (let b = 1; b <= 4; b++) {
            const has = binIdx % 4 !== 0;
            const product = has ? products[binIdx % products.length] : null;
            await db.bin.create({
              data: {
                warehouseId: wh.id,
                zone: z,
                rack: `R${r}`,
                shelf: `S${s}`,
                bin: `B${b}`,
                capacity: 100,
                occupied: has ? Math.floor(seed(binIdx) * 100) : 0,
                productId: product?.id,
                qty: has ? Math.floor(seed(binIdx + 22) * 90 + 5) : 0,
                batch: has && product?.batchTracked ? `BT-${String(2000 + (binIdx % 100))}` : null,
              },
            });
            binIdx++;
          }
        }
      }
    }
  }
  console.log(`✓ Bins (${binIdx})`);

  // ==================== Vendors ====================
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
  const cities = ["Pune", "Chennai", "Mumbai", "Bangalore", "Hyderabad", "Coimbatore", "Delhi"];
  const vendors = await Promise.all(
    vendorNames.map((name, i) =>
      db.vendor.create({
        data: {
          code: `V${String(i + 1).padStart(3, "0")}`,
          name,
          gst: `27ABCDE${String(1000 + i)}F1Z${i % 9}`,
          contact: `+91 9${String(800000000 + i * 73219).slice(-9)}`,
          rating: Math.round((3 + seed(i + 4) * 2) * 10) / 10,
          leadTimeDays: 3 + Math.floor(seed(i + 5) * 14),
          city: pick(cities, i),
        },
      })
    )
  );
  console.log(`✓ Vendors (${vendors.length})`);

  // ==================== Price Lists ====================
  // Three tiers covering the typical Retail / Dealer / Distributor B2B
  // structure. Each list uses a multiplier as the default formula and we
  // also seed a handful of explicit overrides + a quantity-break tier so
  // the resolver waterfall is exercised.
  const retailList = await db.priceList.create({
    data: {
      code: "RETAIL",
      name: "Retail (MRP)",
      description: "Walk-in / direct customers - full sellingPrice",
      basis: "selling",
      multiplier: 1.0,
      isDefault: true,
    },
  });
  const dealerList = await db.priceList.create({
    data: {
      code: "DEALER",
      name: "Dealer (15% off MRP)",
      description: "Mid-tier B2B partners",
      basis: "selling",
      multiplier: 0.85,
    },
  });
  const distributorList = await db.priceList.create({
    data: {
      code: "DISTRIBUTOR",
      name: "Distributor (25% off MRP)",
      description: "Bulk volume contractual partners",
      basis: "selling",
      multiplier: 0.75,
    },
  });
  console.log(`✓ Price lists (Retail, Dealer, Distributor)`);

  // Sample explicit overrides + a quantity-break tier on the top 6
  // products so we can demonstrate the waterfall.
  const topProducts = products.slice(0, 6);
  for (let i = 0; i < topProducts.length; i++) {
    const p = topProducts[i];
    // Dealer: explicit price slightly lower than the formula would yield
    await db.priceListItem.create({
      data: {
        priceListId: dealerList.id,
        productId: p.id,
        price: Math.round(p.sellingPrice * 0.82), // 18% off (better than formula)
        minQty: 1,
      },
    });
    // Dealer quantity-break at 10+
    await db.priceListItem.create({
      data: {
        priceListId: dealerList.id,
        productId: p.id,
        price: Math.round(p.sellingPrice * 0.78), // 22% off
        minQty: 10,
      },
    });
    // Distributor: explicit price
    await db.priceListItem.create({
      data: {
        priceListId: distributorList.id,
        productId: p.id,
        price: Math.round(p.sellingPrice * 0.72), // 28% off
        minQty: 1,
      },
    });
    // Distributor quantity-break at 50+
    await db.priceListItem.create({
      data: {
        priceListId: distributorList.id,
        productId: p.id,
        price: Math.round(p.sellingPrice * 0.68),
        minQty: 50,
      },
    });
  }
  console.log(`✓ Price list overrides + qty breaks for ${topProducts.length} products`);

  // ==================== Customers ====================
  const customerNames = [
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
  const customers = await Promise.all(
    customerNames.map((name, i) =>
      db.customer.create({
        data: {
          code: `C${String(i + 1).padStart(3, "0")}`,
          name,
          gst: `27ABCDE${String(2000 + i)}F1Z${i % 9}`,
          city: pick(cities, i),
          contact: `+91 9${String(700000000 + i * 33713).slice(-9)}`,
          // Tiered credit so the credit-limit gate has realistic data:
          // top 3 = 25L, next 4 = 10L, rest = 0 (cash-only).
          creditLimit: i < 3 ? 2500000 : i < 7 ? 1000000 : 0,
          // Tiered pricing: top 3 = DISTRIBUTOR, next 4 = DEALER, rest = RETAIL
          priceListId:
            i < 3
              ? distributorList.id
              : i < 7
                ? dealerList.id
                : retailList.id,
        },
      })
    )
  );
  console.log(`✓ Customers (${customers.length})`);

  // ==================== Purchase Orders ====================
  for (let i = 0; i < 24; i++) {
    const v = pick(vendors, i);
    const status = pick(["draft", "approved", "partial", "received", "closed"] as const, i + 1);
    const date = new Date(Date.now() - i * 86400000 * (1 + seed(i)) * 0.7);
    const po = await db.purchaseOrder.create({
      data: {
        poNo: `PO-2026-${String(1100 + i)}`,
        vendorId: v.id,
        date,
        expectedDate: new Date(date.getTime() + 86400000 * v.leadTimeDays),
        status,
        amount: 0,
        receivedPct:
          status === "received" || status === "closed"
            ? 100
            : status === "partial"
              ? Math.floor(seed(i + 11) * 80) + 10
              : 0,
      },
    });
    let total = 0;
    const itemCount = 2 + Math.floor(seed(i + 10) * 8);
    for (let k = 0; k < itemCount; k++) {
      const p = products[(i * 3 + k) % products.length];
      const qty = Math.round(10 + seed(i + k) * 200);
      const rate = p.costPrice;
      const amount = qty * rate;
      total += amount;
      await db.purchaseOrderItem.create({
        data: {
          poId: po.id,
          productId: p.id,
          qty,
          rate,
          amount,
          received: po.receivedPct === 100 ? qty : Math.floor(qty * (po.receivedPct / 100)),
        },
      });
    }
    await db.purchaseOrder.update({ where: { id: po.id }, data: { amount: total } });

    if (status === "partial" || status === "received" || status === "closed") {
      await db.grn.create({
        data: {
          grnNo: `GRN-${String(1140 + i)}`,
          poId: po.id,
          qcStatus: pick(["pass", "pass", "pass", "rework", "reject"] as const, i),
        },
      });
    }
  }
  console.log("✓ Purchase Orders + GRNs");

  // ==================== BOMs ====================
  const bomFor = products.filter((p) => p.type === "finished" || p.type === "semi").slice(0, 6);
  const boms = await Promise.all(
    bomFor.map(async (p, i) => {
      const bom = await db.bom.create({
        data: { productId: p.id, revision: `Rev-${i + 1}.0`, outputQty: 1 },
      });
      const components = products.filter((c) => c.type === "raw" || c.type === "consumable").slice(i * 2, i * 2 + 5);
      for (const c of components) {
        await db.bomItem.create({
          data: {
            bomId: bom.id,
            productId: c.id,
            qty: Math.round((1 + seed(i) * 8) * 10) / 10,
            uom: c.uom,
            scrapPct: Math.round(seed(i + 27) * 50) / 10,
          },
        });
      }
      return bom;
    })
  );
  console.log(`✓ BOMs (${boms.length})`);

  // ==================== Production Orders ====================
  for (let i = 0; i < 18; i++) {
    const bom = boms[i % boms.length];
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
    const po = await db.productionOrder.create({
      data: {
        orderNo: `MO-2026-${String(2200 + i)}`,
        bomId: bom.id,
        station: `Line-${(i % 4) + 1}`,
        plannedQty: planned,
        actualQty: actual,
        scrapQty: Math.floor(actual * 0.02),
        reworkQty: Math.floor(actual * 0.01),
        status,
        startDate,
        dueDate: new Date(startDate.getTime() + 86400000 * 5),
        efficiency: Math.round((75 + seed(i + 15) * 22) * 10) / 10,
      },
    });
    const stages = ["Cutting", "Welding", "Assembly", "QC", "Pack"];
    const woCount = 3 + (i % 3);
    for (let j = 0; j < woCount; j++) {
      await db.workOrder.create({
        data: {
          workOrderNo: `${po.orderNo}/${j + 1}`,
          productionOrderId: po.id,
          station: stages[j],
          machine: `M-${stages[j].slice(0, 2).toUpperCase()}-${(j % 4) + 1}`,
          workers: `Worker ${(i * 3 + j) % 12 + 1}`,
          output: Math.floor(seed(i + j + 17) * 200) + 40,
          target: 200,
          startTime: new Date(Date.now() - (5 - j) * 3600000),
          endTime: j < 2 ? new Date(Date.now() - (4 - j) * 3600000) : null,
          status: pick(["queued", "running", "running", "paused", "complete"] as const, i + j),
        },
      });
    }
  }
  console.log("✓ Production Orders + Work Orders");

  // ==================== Workers ====================
  const workerNames = [
    "Rajesh Kumar","Suresh Patel","Mahesh Singh","Ramesh Sharma","Anil Yadav",
    "Vijay Mehta","Pankaj Shah","Mohan Reddy","Vinod Joshi","Imran Khan",
    "Karan Verma","Deepak Rao","Ashok Iyer","Naveen Pillai","Manoj Das",
  ];
  for (let i = 0; i < workerNames.length; i++) {
    const target = 240;
    const units = Math.floor(target * (0.6 + seed(i + 19) * 0.5));
    await db.worker.create({
      data: {
        empNo: `EMP${String(1001 + i)}`,
        name: workerNames[i],
        station: `Line-${(i % 4) + 1}`,
        shift: (["A", "B", "C"] as const)[i % 3],
        status: i % 7 === 0 ? "break" : i % 13 === 0 ? "out" : "in",
        unitsToday: units,
        targetToday: target,
        efficiency: Math.round((units / target) * 1000) / 10,
        rejectionRate: Math.round(seed(i + 20) * 30) / 10,
        hoursToday: Math.round((5 + seed(i + 21) * 3) * 10) / 10,
      },
    });
  }
  console.log("✓ Workers");

  // ==================== Stock Ledger ====================
  const txTypes = ["GRN", "Issue", "Transfer", "Sale", "Production", "Adjust"] as const;
  for (let i = 0; i < 60; i++) {
    const p = products[i % products.length];
    const tx = pick(txTypes, i);
    const sign = tx === "GRN" || tx === "Production" ? 1 : tx === "Adjust" ? (i % 2 ? 1 : -1) : -1;
    const qty = sign * Math.floor(seed(i + 28) * 80 + 4);
    const wh = pick(warehouses, i);
    await db.stockLedger.create({
      data: {
        date: new Date(Date.now() - i * 3600000 * 1.5),
        productId: p.id,
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
        warehouseId: wh.id,
        bin: `${pick(zones, i)}-${(i % 4) + 1}-${(i % 3) + 1}-${(i % 4) + 1}`,
        balance: p.stockOnHand + qty,
      },
    });
  }
  console.log("✓ Stock Ledger");

  // ==================== Invoices + Dispatches ====================
  for (let i = 0; i < 28; i++) {
    const customer = pick(customers, i);
    const status = pick(["paid", "paid", "paid", "issued", "partial", "overdue", "draft"] as const, i);
    const inv = await db.invoice.create({
      data: {
        invoiceNo: `INV-2026-${String(5500 + i)}`,
        customerId: customer.id,
        date: new Date(Date.now() - i * 86400000 * 0.5),
        amount: 0,
        tax: 0,
        status,
        paymentMode: pick(["cash", "card", "upi", "credit", "split"] as const, i + 2),
      },
    });
    let sub = 0;
    const itemCount = 1 + Math.floor(seed(i + 24) * 6);
    for (let k = 0; k < itemCount; k++) {
      const p = pick(products.filter((p) => p.type === "finished" || p.type === "semi"), i + k);
      const qty = 1 + Math.floor(seed(i + k + 31) * 8);
      const rate = p.sellingPrice;
      const amount = qty * rate;
      sub += amount;
      await db.invoiceItem.create({
        data: { invoiceId: inv.id, productId: p.id, qty, rate, amount },
      });
    }
    const tax = Math.round(sub * 0.18);
    await db.invoice.update({ where: { id: inv.id }, data: { amount: sub + tax, tax } });
  }
  const invoicesCreated = await db.invoice.findMany();

  const drivers = ["Ramesh K", "Suresh M", "Pankaj S", "Vinod R", "Mohan T", "Imran S"];
  for (let i = 0; i < 14; i++) {
    const inv = invoicesCreated[i % invoicesCreated.length];
    await db.dispatchOrder.create({
      data: {
        dispatchNo: `DSP-2026-${String(3300 + i)}`,
        invoiceId: inv.id,
        vehicle: `MH-12-${String(1000 + i * 73).slice(-4)}`,
        driver: pick(drivers, i),
        destination: pick(cities, i),
        status: pick(["planned", "loading", "in-transit", "in-transit", "delivered", "delayed"] as const, i),
        etaHours: Math.round(seed(i + 25) * 36 + 2),
        weightKg: Math.round(200 + seed(i + 26) * 4000),
      },
    });
  }
  console.log(`✓ Invoices + Dispatches`);

  // ==================== Approvals ====================
  await db.approval.createMany({
    data: [
      { ref: "PR-2206", type: "Purchase Request", requestedBy: "Sandeep Kumar", amount: 425000, priority: "high", reason: "Q3 forecast restock for Bearing 6205, MS Plate 6mm." },
      { ref: "ADJ-203", type: "Stock Adjustment", requestedBy: "Naveen Pillai", amount: -28400, priority: "med", reason: "Cycle count variance on Hex Bolt M10x40 in WH-RAW/A-2-3." },
      { ref: "PO-2026-1124", type: "PO Amendment", requestedBy: "Procurement Team", amount: 90000, priority: "med", reason: "Vendor revised price for Steel Coil 2mm by ₹2/kg." },
      { ref: "PR-2210", type: "Purchase Request", requestedBy: "Maintenance Team", amount: 165000, priority: "low", reason: "Spare parts for Cutter 1 — preventive maintenance." },
      { ref: "OVR-19", type: "Price Override", requestedBy: "Counter 2", amount: -12000, priority: "low", reason: "Bulk discount for Hindustan Motors Ltd — 4% over policy." },
    ],
  });
  console.log("✓ Approvals");

  // ==================== Quotes + Sales Orders ====================
  // A small spread that demonstrates each status the UI cares about.
  const finishedAndSemi = products.filter((p) => p.type === "finished" || p.type === "semi");
  const quoteSpec: { status: "draft" | "submitted" | "accepted" | "expired"; days: number }[] = [
    { status: "draft", days: 0 },
    { status: "submitted", days: 1 },
    { status: "submitted", days: 3 },
    { status: "accepted", days: 5 },
    { status: "accepted", days: 8 },
    { status: "expired", days: 35 },
  ];
  let qIdx = 0;
  for (const spec of quoteSpec) {
    qIdx++;
    const customer = pick(customers, qIdx);
    const itemCount = 1 + Math.floor(seed(qIdx + 50) * 4);
    let sub = 0;
    const itemPayload: {
      productId: string;
      qty: number;
      rate: number;
      discount: number;
      amount: number;
    }[] = [];
    for (let k = 0; k < itemCount; k++) {
      const p = pick(finishedAndSemi, qIdx + k + 13);
      const qty = 1 + Math.floor(seed(qIdx + k + 60) * 12);
      const rate = p.sellingPrice;
      const discount = qIdx % 3 === 0 ? 5 : 0;
      const amount = qty * rate * (1 - discount / 100);
      sub += amount;
      itemPayload.push({ productId: p.id, qty, rate, discount, amount });
    }
    const tax = Math.round(sub * 0.18);
    const total = sub + tax;
    const validUntil = new Date(Date.now() + (30 - spec.days) * 86400000);
    const quote = await db.quote.create({
      data: {
        quoteNo: `Q-2026-${String(1000 + qIdx).padStart(4, "0")}`,
        revision: spec.status === "submitted" && qIdx === 3 ? 2 : 1,
        customerId: customer.id,
        status: spec.status,
        validUntil,
        subTotal: sub,
        tax,
        total,
        paymentTerms: "Net 30",
        notes: spec.status === "expired" ? "Customer never confirmed." : null,
        acceptedAt: spec.status === "accepted" ? new Date(Date.now() - spec.days * 86400000 * 0.5) : null,
        createdById: "seed",
        createdAt: new Date(Date.now() - spec.days * 86400000),
        items: { create: itemPayload },
      },
    });
    // Synthetic prior revision for the one quote with revision=2
    if (quote.revision === 2) {
      await db.quoteRevision.create({
        data: {
          quoteId: quote.id,
          revision: 1,
          snapshot: JSON.stringify({
            ...quote,
            items: itemPayload.map((it) => ({ ...it, qty: it.qty + 2 })),
          }),
          reason: "customer_request",
          changedBy: "seed",
        },
      });
    }
    // Convert accepted quotes into Sales Orders
    if (spec.status === "accepted") {
      const so = await db.salesOrder.create({
        data: {
          soNo: `SO-2026-${String(2000 + qIdx).padStart(4, "0")}`,
          quoteId: quote.id,
          customerId: customer.id,
          status: qIdx === 4 ? "partially_invoiced" : "confirmed",
          subTotal: sub,
          tax,
          total,
          orderDate: quote.acceptedAt ?? new Date(),
          items: {
            create: itemPayload.map((it) => ({
              productId: it.productId,
              qtyOrdered: it.qty,
              qtyInvoiced: qIdx === 4 ? Math.floor(it.qty / 2) : 0,
              rate: it.rate,
              amount: it.amount,
            })),
          },
        },
      });
      await db.quote.update({
        where: { id: quote.id },
        data: { status: "converted", convertedSalesOrderId: so.id },
      });
    }
  }
  console.log("✓ Quotes + Sales Orders");

  console.log("\nDone. Default credentials:");
  console.log("  Username: arjun.patel    Password: nova1234    PIN: 123456");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
