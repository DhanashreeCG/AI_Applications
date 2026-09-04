import { AssetReference } from '../../interfaces/flashcard.interfaces';

export function resolveImageSource(
  assetReference: AssetReference | null | undefined,
  apiBaseUrl: string,
): string | null {
  if (!assetReference) {
    return null;
  }

  if (assetReference.imageUrl) {
    return /^(https?:|data:|blob:)/i.test(assetReference.imageUrl)
      ? assetReference.imageUrl
      : `${apiBaseUrl.replace(/\/$/, '')}${assetReference.imageUrl}`;
  }

  return assetReference.signedUrl || null;
}
