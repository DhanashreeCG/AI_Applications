import { VisionAnalysisResult } from '../../../src/common/dto/vision-metadata.dto';

export const TEST_DRIVE_FOLDER_ID = 'drive-folder-test-001';
export const TEST_DRIVE_FILE_ID = 'drive-file-cat-001';
export const TEST_DRIVE_FILE_NAME = 'orange-cat.png';

export const TEST_DRIVE_FILE = {
  id: TEST_DRIVE_FILE_ID,
  name: TEST_DRIVE_FILE_NAME,
  mimeType: 'image/gif',
  size: 43,
  folderPath: '/animals/cats',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
};

export const TEST_SEARCH_DESCRIPTION =
  'A playful orange cat sitting on a sunny windowsill with warm natural light';

export const TEST_VISION_ANALYSIS: VisionAnalysisResult = {
  metadata: {
    caption: 'Orange cat on a windowsill',
    objects: ['cat', 'windowsill'],
    actions: ['sitting'],
    styles: ['photograph', 'natural light'],
    colors: ['orange', 'white'],
    background: 'indoor window',
    composition: 'centered subject',
    orientation: 'landscape',
    age_groups: ['6-10', '10-13'],
    grades: ['kids', 'teens'],
    educational_uses: ['animal recognition'],
    search_keywords: ['cat', 'orange', 'windowsill', 'pet'],
  },
  searchDescription: TEST_SEARCH_DESCRIPTION,
  rawResponse: { source: 'test-fixture' },
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  modelVersion: '1.0',
  promptVersion: 'v1',
};

export const TEST_SEARCH_QUERY = 'orange cat on windowsill';
