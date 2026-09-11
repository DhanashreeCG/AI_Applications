-- Keep one embedding row per asset (storeEmbedding already updates in place).
-- NOTE: Despite the folder name, this migration does NOT create an HNSW index.
-- It only dedupes rows and enforces UNIQUE(assetId) so a later HNSW index can
-- target one vector per asset. See 20260911140000_asset_embedding_vector_hnsw_index.
DELETE FROM "AssetEmbedding" AS older
USING "AssetEmbedding" AS newer
WHERE older."assetId" = newer."assetId"
  AND (
    older."embeddingVersion" < newer."embeddingVersion"
    OR (
      older."embeddingVersion" = newer."embeddingVersion"
      AND older."updatedAt" < newer."updatedAt"
    )
    OR (
      older."embeddingVersion" = newer."embeddingVersion"
      AND older."updatedAt" = newer."updatedAt"
      AND older.id < newer.id
    )
  );

DROP INDEX IF EXISTS "AssetEmbedding_assetId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "AssetEmbedding_assetId_key" ON "AssetEmbedding"("assetId");
