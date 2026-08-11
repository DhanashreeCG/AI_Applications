-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Ensure HNSW index exists on AssetEmbedding vector column if created
-- CREATE INDEX IF NOT EXISTS asset_embedding_vector_hnsw_idx ON "AssetEmbedding" USING hnsw ("vector" vector_cosine_ops);
