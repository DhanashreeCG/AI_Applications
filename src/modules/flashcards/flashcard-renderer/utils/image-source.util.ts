import { AssetReference } from '../../interfaces/flashcard.interfaces';

export function resolveImageSource(
  assetReference: AssetReference | null | undefined,
  apiBaseUrl: string,
): string | null {
  if (!assetReference) {
    return null;
  }

  if (assetReference.imageUrl) {
    return assetReference.imageUrl.startsWith('http')
      ? assetReference.imageUrl
      : `${apiBaseUrl.replace(/\/$/, '')}${assetReference.imageUrl}`;
  }

  return assetReference.signedUrl || null;
}
