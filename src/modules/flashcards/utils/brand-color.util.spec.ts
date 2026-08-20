import {
  isUnusableAssetColor,
  resolveFlashcardBrandColor,
  resolveFlashcardBrandTheme,
} from './brand-color.util';

describe('brand-color.util', () => {
  it('skips white and near-white values', () => {
    expect(isUnusableAssetColor('white')).toBe(true);
    expect(isUnusableAssetColor('#FFFFFF')).toBe(true);
    expect(isUnusableAssetColor('#fff')).toBe(true);
    expect(isUnusableAssetColor('green')).toBe(false);
  });

  it('maps metadata color names onto brand frames', () => {
    expect(resolveFlashcardBrandColor(['white', 'green'])).toBe('#3DD68C');
    expect(resolveFlashcardBrandColor(['yellow'])).toBe('#FFD233');
    expect(resolveFlashcardBrandColor(['pink'])).toBe('#FF3D8B');
  });

  it('snaps hex values to the nearest brand color', () => {
    expect(resolveFlashcardBrandColor(['#2ecc71'])).toBe('#3DD68C');
  });

  it('returns null when every color is unusable', () => {
    expect(resolveFlashcardBrandTheme(['white', 'ivory'])).toBeNull();
  });
});
