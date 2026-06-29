-- Optional zone hint for in-situ production lines (e.g. vacuum packing in STR zone A).
ALTER TABLE "WorkCenter" ADD COLUMN "productionZone" TEXT;
