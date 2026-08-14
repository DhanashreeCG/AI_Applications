export const WORKSHEET_CONTENT_STAGE = 'worksheet_content';
export const WORKSHEET_EDIT_STAGE = 'worksheet_edit';
export const GENERIC_RENDERER_TYPE = 'generic';
export const WORKSHEET_ASSET_IMAGE_PATH = '/worksheets/assets';
export const ENRICHMENT_KEYS = new Set(['assetId']);
export const WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}
