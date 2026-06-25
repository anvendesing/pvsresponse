#!/usr/bin/env tsx

/**

 * Create / update godown warehouses and sync shelf layout metadata.

 * Does **not** create placeholder bins — godowns are scanned at shelf level;

 * bins appear when stock is put away.

 *

 *   npm run db:seed-godowns:dev

 *   npm run db:seed-godowns:dev -- --dry-run

 */



import { PrismaClient } from "@prisma/client";

import { shelfCodeFromRow } from "../lib/codes.js";

import {

  GODOWN_LAYOUTS,

  shelfRows,

  type GodownLayout,

} from "../lib/godown-layouts.js";



const dryRun = process.argv.includes("--dry-run");

const db = new PrismaClient();



async function resolveWarehouse(layout: GodownLayout) {

  let wh = await db.warehouse.findUnique({ where: { code: layout.code } });



  if (!wh) {

    if (dryRun) {

      console.log(

        `[DRY RUN] Would create ${layout.code} ("${layout.name}") scanPrefix=${layout.scanPrefix}`

      );

      return {

        id: "dry-run",

        code: layout.code,

        name: layout.name,

        scanPrefix: layout.scanPrefix,

      };

    }

    wh = await db.warehouse.create({

      data: {

        code: layout.code,

        name: layout.name,

        city: "Kothavaripalle, AP",

        scanPrefix: layout.scanPrefix,

        kind: layout.kind,

        active: true,

      },

    });

    console.log(`Created warehouse ${wh.code} ("${layout.name}")`);

  } else {

    const needsMeta =

      wh.name !== layout.name ||

      wh.scanPrefix !== layout.scanPrefix ||

      wh.kind !== layout.kind;

    if (needsMeta && !dryRun) {

      wh = await db.warehouse.update({

        where: { id: wh.id },

        data: {

          name: layout.name,

          scanPrefix: layout.scanPrefix,

          kind: layout.kind,

        },

      });

      console.log(`Updated warehouse ${wh.code} metadata`);

    }

  }



  return wh;

}



async function seedLayout(layout: GodownLayout) {

  const wh = await resolveWarehouse(layout);

  const planned = shelfRows(layout.zones);

  const plannedKeys = new Set(planned.map((r) => `${r.zone}/${r.shelf}`));



  if (dryRun && wh.id === "dry-run") {

    console.log(

      `[DRY RUN] ${layout.code}: ${planned.length} shelves`,

      layout.zones.map((z) => `${z.zone}=${z.shelfCount}`).join(", ")

    );

    return;

  }



  const existingBins = await db.bin.findMany({

    where: { warehouseId: wh.id },

    select: {

      id: true,

      zone: true,

      shelf: true,

      bin: true,

      qty: true,

      reservedQty: true,

      productId: true,

      variantId: true,

      code: true,

    },

  });



  const emptyPlaceholders = existingBins.filter(

    (b) =>

      plannedKeys.has(`${b.zone}/${b.shelf}`) &&

      b.bin === "01" &&

      (b.qty ?? 0) === 0 &&

      (b.reservedQty ?? 0) === 0 &&

      !b.productId &&

      !b.variantId

  );



  console.log(

    dryRun ? "[DRY RUN] " : "",

    `${layout.code}: ${planned.length} shelves,`,

    `${existingBins.length} bin row(s) in DB,`,

    `${emptyPlaceholders.length} empty shelf placeholder(s) to remove`,

    `(${layout.zones.map((z) => `zone ${z.zone}×${z.shelfCount}`).join(", ")})`

  );



  if (dryRun) return;



  if (emptyPlaceholders.length > 0) {

    await db.bin.deleteMany({

      where: { id: { in: emptyPlaceholders.map((b) => b.id) } },

    });

    console.log(`  Removed ${emptyPlaceholders.length} placeholder bin(s).`);

  }



  const sample = planned[0];

  if (sample) {

    console.log(

      `  Example shelf scan: ${shelfCodeFromRow(sample, { code: wh.code, scanPrefix: wh.scanPrefix })}`

    );

  }

}



async function main() {

  for (const layout of GODOWN_LAYOUTS) {

    await seedLayout(layout);

  }

  console.log("\nDone. Generate shelf labels: npm run labels:godowns");

}



main()

  .catch((e) => {

    console.error(e);

    process.exit(1);

  })

  .finally(() => db.$disconnect());

