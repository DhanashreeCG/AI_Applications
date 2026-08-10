-- Add grade-band classifications while retaining ageGroups for numeric ranges.
ALTER TABLE "AssetMetadata"
ADD COLUMN "grades" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
