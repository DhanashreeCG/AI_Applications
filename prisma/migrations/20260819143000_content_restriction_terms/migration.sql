-- CreateEnum
CREATE TYPE "ContentRestrictionSeverity" AS ENUM ('BANNED', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "ContentRestrictionCategory" AS ENUM ('ANIMAL_FOOD', 'VISUAL_MOTIF', 'RELIGIOUS', 'OTHER');

-- CreateTable
CREATE TABLE "ContentRestrictionTerm" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "category" "ContentRestrictionCategory" NOT NULL,
    "severity" "ContentRestrictionSeverity" NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT '*',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentRestrictionTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentRestrictionTerm_term_countryCode_severity_key" ON "ContentRestrictionTerm"("term", "countryCode", "severity");

-- CreateIndex
CREATE INDEX "ContentRestrictionTerm_active_countryCode_idx" ON "ContentRestrictionTerm"("active", "countryCode");

-- CreateIndex
CREATE INDEX "ContentRestrictionTerm_active_severity_idx" ON "ContentRestrictionTerm"("active", "severity");

-- CreateIndex
CREATE INDEX "ContentRestrictionTerm_category_idx" ON "ContentRestrictionTerm"("category");
