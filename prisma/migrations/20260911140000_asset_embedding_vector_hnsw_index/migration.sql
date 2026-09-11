-- Prior migration 20260903121500_asset_embedding_hnsw only deduped rows /
-- unique(assetId). HNSW itself was never created.
-- On this RDS DB the vector extension (and its opclasses) live in schema
-- "extensions", so the opclass must be schema-qualified for migrate.

CREATE INDEX IF NOT EXISTS asset_embedding_vector_hnsw_idx
ON "AssetEmbedding"
USING hnsw (vector extensions.vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
