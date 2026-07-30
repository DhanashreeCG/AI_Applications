import { createHash } from 'crypto';
import { SearchAssetsDto } from '../../search/dto/search-assets.dto';

export function buildSearchCacheKey(dto: SearchAssetsDto): string {
  const payload = JSON.stringify({
    query: dto.query.trim(),
    limit: dto.limit ?? 10,
    filters: dto.filters ?? {},
  });

  return `search:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export function buildAssetMetadataCacheKey(assetId: string): string {
  return `asset:metadata:${assetId}`;
}

export const SEARCH_CACHE_PATTERN = 'search:*';
export const ASSET_METADATA_CACHE_PATTERN = 'asset:metadata:*';
