-- Pick-list walk-path sorting toggle on CompanyProfile.
ALTER TABLE "CompanyProfile" ADD COLUMN "pickSortByBinEnabled" BOOLEAN NOT NULL DEFAULT true;
