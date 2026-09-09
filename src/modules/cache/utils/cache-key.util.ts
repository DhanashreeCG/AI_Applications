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

export function buildTranslationFragmentCacheKey(
  sourceLanguage: string,
  targetLanguage: string,
  text: string,
  mimeType: 'text/plain' | 'text/html' = 'text/plain',
): string {
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  const mimeTag = mimeType === 'text/html' ? 'html' : 'plain';
  return `translation:${sourceLanguage}:${targetLanguage}:${mimeTag}:${hash}`;
}

export const SEARCH_CACHE_PATTERN = 'search:*';
export const ASSET_METADATA_CACHE_PATTERN = 'asset:metadata:*';
export const TRANSLATION_CACHE_PATTERN = 'translation:*';
