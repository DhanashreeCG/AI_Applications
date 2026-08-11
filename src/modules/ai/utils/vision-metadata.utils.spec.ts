import { VisionMetadataDto } from '../../../common/dto/vision-metadata.dto';
import { buildSearchDescription } from './search-description.builder';
import { parseVisionMetadata } from './vision-metadata.parser';

describe('vision metadata utilities', () => {
  it('should parse and normalize vision metadata', () => {
    const metadata = parseVisionMetadata({
      caption: ' A red cat ',
      objects: ['cat', 123, 'sofa'],
      actions: [' sitting '],
      styles: ['photo'],
      colors: ['red'],
      background: 'living room',
      composition: 'centered subject',
      orientation: 'landscape',
      age_groups: [' 3 - 6 ', 'kids', '10-6'],
      grades: ['Kids', 'invalid'],
      educational_uses: [],
      search_keywords: ['pet'],
    });

    expect(metadata).toEqual({
      caption: 'A red cat',
      objects: ['cat', 'sofa'],
      actions: ['sitting'],
      styles: ['photo'],
      colors: ['red'],
      background: 'living room',
      composition: 'centered subject',
      orientation: 'landscape',
      age_groups: ['3-6'],
      grades: ['kids'],
      educational_uses: [],
      search_keywords: ['pet'],
      extra_tags: undefined,
    });
  });

  it('should build a deterministic search description', () => {
    const metadata: VisionMetadataDto = {
      caption: 'Cute cartoon elephant holding a red balloon.',
      objects: ['elephant', 'balloon'],
      actions: ['holding'],
      styles: ["Children's illustration"],
      colors: ['gray', 'red', 'white'],
      background: 'White background.',
      composition: 'Single animal character.',
      orientation: 'portrait',
      age_groups: ['3-6', '6-10'],
      grades: ['toddlers', 'kids'],
      educational_uses: ['worksheets'],
      search_keywords: ['cartoon', 'animal'],
    };

    expect(buildSearchDescription(metadata)).toBe(
      [
        'Cute cartoon elephant holding a red balloon.',
        'elephant, balloon',
        'holding',
        "Children's illustration",
        'gray, red, white',
        'White background.',
        'Single animal character.',
        'worksheets',
        'cartoon, animal',
      ].join('\n'),
    );
  });
});
