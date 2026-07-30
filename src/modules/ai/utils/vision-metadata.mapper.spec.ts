import { mapVisionAnalysisToAssetMetadata } from './vision-metadata.mapper';
import { VisionAnalysisResult } from '../../../common/dto/vision-metadata.dto';

describe('vision-metadata.mapper', () => {
  it('should map vision analysis into AssetMetadata fields', () => {
    const analysis: VisionAnalysisResult = {
      metadata: {
        caption: 'A red cat on a sofa.',
        objects: ['cat', 'sofa'],
        actions: ['sitting'],
        styles: ['photo'],
        colors: ['red'],
        background: 'living room',
        composition: 'centered subject',
        orientation: 'landscape',
        age_groups: ['kids'],
        educational_uses: ['worksheets'],
        search_keywords: ['pet'],
      },
      searchDescription: 'A red cat on a sofa.\ncat, sofa',
      rawResponse: { caption: 'A red cat on a sofa.' },
      provider: 'google-gemini',
      model: 'gemini-2.5-flash',
      modelVersion: 'gemini-2.5-flash',
      promptVersion: 'v1',
    };

    expect(mapVisionAnalysisToAssetMetadata(analysis, 'hash-123')).toEqual({
      caption: 'A red cat on a sofa.',
      objects: ['cat', 'sofa'],
      actions: ['sitting'],
      styles: ['photo'],
      colors: ['red'],
      background: 'living room',
      composition: 'centered subject',
      orientation: 'landscape',
      ageGroups: ['kids'],
      educationalUses: ['worksheets'],
      searchKeywords: ['pet'],
      searchDescription: 'A red cat on a sofa.\ncat, sofa',
      searchDescriptionHash: 'hash-123',
      rawResponse: { caption: 'A red cat on a sofa.' },
      provider: 'google-gemini',
      model: 'gemini-2.5-flash',
      modelVersion: 'gemini-2.5-flash',
      promptVersion: 'v1',
    });
  });
});
