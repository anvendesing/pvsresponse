-- Add zone-level destination to putaway rules so a rule can target
-- a staging zone (e.g. STR.PR) without pinning a specific bin.

ALTER TABLE "PutawayRule" ADD COLUMN "toZone" TEXT;
