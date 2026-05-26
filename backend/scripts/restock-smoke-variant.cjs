const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  await db.productVariant.updateMany({
    where: { sku: "AGRB-JAS-90STICKS-02" },
    data: { stockOnHand: 50 },
  });
  console.log("restocked AGRB-JAS-90STICKS-02 to 50");
  await db.$disconnect();
})();
