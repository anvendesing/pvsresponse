// Seed bins with a believable spread of inventory so picking and packing
// flows have something to work against in dev/demo.
//
// Behaviour:
//   - Wipes existing bin assignments AND stock ledger rows so re-runs are
//     deterministic.
//   - Fills ~75% of bins; each filled bin holds one random product, qty
//     well within the bin's capacity, and a synthetic batch tag.
//   - Products with variants get the parent's stock split proportionally
//     across their variants (so quotes that reference a specific variant
//     still show realistic ATP).
//   - Logs one StockLedger row per bin assignment (txnType=GRN,
//     ref=OPENING-STOCK) so the inventory page has a consistent history.
//
// Run: cd backend && npx tsx scripts/randomize-stock.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Cheap deterministic PRNG (mulberry32) so re-runs across a single dataset
// produce consistent placements for screenshot/demo continuity.
const seedPRNG = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rnd = seedPRNG(1747584000); // 2026-05-18

// Fisher-Yates with our PRNG.
const shuffle = <T>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const ri = (lo: number, hi: number) =>
  Math.floor(rnd() * (hi - lo + 1)) + lo;

// What share of bins to fill.
const FILL_RATIO = 0.78;

async function main() {
  console.log("Resetting stock state…");
  // Wipe ledger first (FKs to product/warehouse), then bin contents. We
  // leave the physical bins themselves intact so the warehouse map keeps
  // its layout.
  await db.stockLedger.deleteMany();
  await db.bin.updateMany({
    data: { productId: null, qty: 0, occupied: 0, reservedQty: 0, batch: null },
  });
  await db.product.updateMany({ data: { stockOnHand: 0 } });
  await db.productVariant.updateMany({ data: { stockOnHand: 0 } });

  const warehouses = await db.warehouse.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
  });
  if (!warehouses.length) {
    console.error("No active warehouses found. Add at least one in Settings.");
    process.exit(1);
  }
  const bins = await db.bin.findMany({
    where: { warehouseId: { in: warehouses.map((w) => w.id) } },
    orderBy: [{ warehouseId: "asc" }, { zone: "asc" }, { rack: "asc" }],
  });
  const products = await db.product.findMany({
    where: { state: "active" },
    include: {
      variants: { where: { active: true } },
    },
  });
  if (!products.length) {
    console.error("No active products found. Run db:import-pricelists first.");
    process.exit(1);
  }

  console.log(
    `${warehouses.length} active warehouses · ${bins.length} bins · ${products.length} products`
  );

  // Targets
  const targetFilled = Math.floor(bins.length * FILL_RATIO);
  const shuffledBins = shuffle(bins).slice(0, targetFilled);

  // Track per-product totals so we can roll up after.
  const productTotals = new Map<string, number>();
  // Same for the ledger; one entry per bin write.
  type LedgerRow = {
    productId: string;
    txnType: string;
    ref: string;
    qty: number;
    warehouseId: string;
    bin: string;
    balance: number;
  };
  const ledgerRows: LedgerRow[] = [];
  const binUpdates: {
    id: string;
    productId: string;
    qty: number;
    occupied: number;
    batch: string;
  }[] = [];

  // For each filled bin pick a random product. Deterministic via shuffled
  // products array + index modulo with a small bias toward popular SKUs.
  const productPool = shuffle(products);
  // Months for batch tags
  const monthCode = (() => {
    const m = new Date().toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
    });
    return m.replace(" ", "").toUpperCase(); // e.g. MAY26
  })();

  let batchCounter = 1;
  for (const bin of shuffledBins) {
    // Slight popularity weight: bias the first 60 products to appear more.
    const popular = rnd() < 0.45;
    const idx = popular
      ? Math.floor(rnd() * Math.min(60, productPool.length))
      : Math.floor(rnd() * productPool.length);
    const p = productPool[idx];

    // Quantity is bounded by capacity so the warehouse map looks healthy.
    // Most bins moderate, ~12% near full.
    const cap = bin.capacity || 100;
    const heavy = rnd() < 0.12;
    const qty = heavy ? ri(Math.floor(cap * 0.85), cap - 1) : ri(15, Math.floor(cap * 0.7));
    const occupied = Math.min(qty, cap);

    // Batch tag - if the product is batch-tracked, give it a unique no.
    // Otherwise keep null. Keeping a tag on every bin improves traceability
    // for picking screenshots.
    const batch = `B-${monthCode}-${String(batchCounter).padStart(4, "0")}`;
    batchCounter++;

    binUpdates.push({
      id: bin.id,
      productId: p.id,
      qty,
      occupied,
      batch,
    });
    productTotals.set(p.id, (productTotals.get(p.id) ?? 0) + qty);
    ledgerRows.push({
      productId: p.id,
      txnType: "GRN",
      ref: "OPENING-STOCK",
      qty,
      warehouseId: bin.warehouseId,
      bin: `${bin.zone}-${bin.rack}-${bin.shelf}-${bin.bin}`,
      balance: 0, // Will be back-filled after grouping per product.
    });
  }

  console.log(`Writing ${binUpdates.length} bin assignments…`);
  await db.$transaction(async (tx) => {
    // Bins
    for (const u of binUpdates) {
      await tx.bin.update({
        where: { id: u.id },
        data: {
          productId: u.productId,
          qty: u.qty,
          occupied: u.occupied,
          batch: u.batch,
        },
      });
    }

    // Product totals + variant proportional split
    console.log("Rolling up product totals…");
    for (const [productId, total] of productTotals) {
      await tx.product.update({
        where: { id: productId },
        data: { stockOnHand: total },
      });
      const product = products.find((p) => p.id === productId);
      if (!product || product.variants.length === 0) continue;
      // Allocate the total across variants. Each variant gets a random
      // share weighted by its index; remainder goes to the first variant.
      const weights = product.variants.map(() => rnd() + 0.4);
      const wSum = weights.reduce((a, b) => a + b, 0);
      let allocated = 0;
      for (let i = 0; i < product.variants.length; i++) {
        const v = product.variants[i];
        const share =
          i === product.variants.length - 1
            ? total - allocated
            : Math.floor((weights[i] / wSum) * total);
        allocated += share;
        await tx.productVariant.update({
          where: { id: v.id },
          data: { stockOnHand: Math.max(0, share) },
        });
      }
    }

    // Stock ledger
    console.log(`Writing ${ledgerRows.length} stock-ledger rows…`);
    // Compute running balance per (product, warehouse) so the inventory
    // ledger looks like a real opening run.
    const balKey = (r: { productId: string; warehouseId: string }) =>
      `${r.productId}::${r.warehouseId}`;
    const running = new Map<string, number>();
    for (const r of ledgerRows) {
      const k = balKey(r);
      const next = (running.get(k) ?? 0) + r.qty;
      running.set(k, next);
      r.balance = next;
    }
    // SQLite-friendly chunked createMany.
    const CHUNK = 250;
    for (let i = 0; i < ledgerRows.length; i += CHUNK) {
      await tx.stockLedger.createMany({
        data: ledgerRows.slice(i, i + CHUNK),
      });
    }
  }, {
    timeout: 60_000,
    maxWait: 60_000,
  });

  // Summary
  const filled = await db.bin.count({ where: { qty: { gt: 0 } } });
  const filledTotal = await db.bin.aggregate({
    _sum: { qty: true },
  });
  const productsStocked = productTotals.size;
  const ledgerCount = await db.stockLedger.count();

  console.log("\n=== Stock seeded ===");
  console.log(`  bins filled        : ${filled} / ${bins.length}`);
  console.log(`  total units        : ${filledTotal._sum.qty ?? 0}`);
  console.log(`  products stocked   : ${productsStocked} / ${products.length}`);
  console.log(`  stock-ledger rows  : ${ledgerCount}`);
  console.log(
    `  warehouses        : ${warehouses.map((w) => w.code).join(", ")}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
