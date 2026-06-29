-- CreateTable
CREATE TABLE "ProductConcern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProductConcernLink" (
    "productId" TEXT NOT NULL,
    "concernId" TEXT NOT NULL,

    PRIMARY KEY ("productId", "concernId"),
    CONSTRAINT "ProductConcernLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductConcernLink_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "ProductConcern" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductConcern_slug_key" ON "ProductConcern"("slug");

-- CreateIndex
CREATE INDEX "ProductConcernLink_concernId_idx" ON "ProductConcernLink"("concernId");

-- CreateIndex
CREATE INDEX "ProductConcernLink_productId_idx" ON "ProductConcernLink"("productId");
