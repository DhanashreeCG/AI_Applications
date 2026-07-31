import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiVisionProvider } from './gemini-vision.provider';
import { buildSearchDescription } from '../utils/search-description.builder';
import { parseVisionMetadata } from '../utils/vision-metadata.parser';

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

describe('GeminiVisionProvider', () => {
  let provider: GeminiVisionProvider;

  const mockMetadata = {
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

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'ai.geminiApiKey':
          return 'test-gemini-key';
        case 'ai.geminiModel':
          return 'gemini-2.5-flash';
        case 'ai.geminiPromptVersion':
          return 'v1';
        default:
          return null;
      }
    }),
  };

  beforeEach(async () => {
    mockGenerateContent.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiVisionProvider,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    provider = module.get<GeminiVisionProvider>(GeminiVisionProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
    expect(provider.providerName).toBe('google-gemini');
    expect(provider.modelName).toBe('gemini-2.5-flash');
  });

  it('should analyze an image and return schema-compliant metadata', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(mockMetadata),
    });

    const imageBuffer = Buffer.from('fake-image-data');
    const result = await provider.analyzeImage({
      imageBuffer,
      mimeType: 'image/jpeg',
      filename: 'elephant.jpg',
    });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        contents: [
          expect.objectContaining({
            role: 'user',
            parts: expect.arrayContaining([
              expect.objectContaining({ text: expect.any(String) }),
              expect.objectContaining({
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: imageBuffer.toString('base64'),
                },
              }),
            ]),
          }),
        ],
        config: expect.objectContaining({
          responseMimeType: 'application/json',
        }),
      }),
    );

    expect(result.metadata).toEqual(parseVisionMetadata(mockMetadata));
    expect(result.searchDescription).toBe(
      buildSearchDescription(parseVisionMetadata(mockMetadata)),
    );
    expect(result.provider).toBe('google-gemini');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.promptVersion).toBe('v1');
    expect(result.rawResponse).toEqual(mockMetadata);
  });

  it('should throw when Gemini client is not initialized', async () => {
    const unconfiguredModule: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiVisionProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(() => null),
          },
        },
      ],
    }).compile();

    const unconfiguredProvider =
      unconfiguredModule.get<GeminiVisionProvider>(GeminiVisionProvider);

    await expect(
      unconfiguredProvider.analyzeImage({
        imageBuffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow('Gemini vision client is not initialized');
  });

  it('should throw when Gemini returns empty response text', async () => {
    mockGenerateContent.mockResolvedValue({ text: '   ' });

    await expect(
      provider.analyzeImage({
        imageBuffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow('Gemini vision response did not contain JSON metadata');
  });

  it('should throw when Gemini returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'not-json' });

    await expect(
      provider.analyzeImage({
        imageBuffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow('Gemini vision response was not valid JSON');
  });
});
