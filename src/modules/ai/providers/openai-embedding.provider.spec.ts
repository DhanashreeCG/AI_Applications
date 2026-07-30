import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider';
import { hashSourceText } from '../utils/source-text-hash.util';
import { OPENAI_EMBEDDING_DIMENSIONS } from '../constants/embedding.constants';

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    embeddings: {
      create: mockCreate,
    },
  })),
}));

describe('OpenAiEmbeddingProvider', () => {
  let provider: OpenAiEmbeddingProvider;

  const sampleEmbedding = Array.from(
    { length: OPENAI_EMBEDDING_DIMENSIONS },
    (_, index) => index / OPENAI_EMBEDDING_DIMENSIONS,
  );

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'ai.openaiApiKey':
          return 'test-openai-key';
        case 'ai.openaiEmbeddingModel':
          return 'text-embedding-3-small';
        default:
          return null;
      }
    }),
  };

  beforeEach(async () => {
    mockCreate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAiEmbeddingProvider,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    provider = module.get<OpenAiEmbeddingProvider>(OpenAiEmbeddingProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
    expect(provider.providerName).toBe('openai');
    expect(provider.modelName).toBe('text-embedding-3-small');
    expect(provider.dimensions).toBe(1536);
  });

  it('should generate a 1536-dim embedding and track source text hash', async () => {
    const inputText = 'Cute cartoon elephant holding a red balloon.';
    mockCreate.mockResolvedValue({
      data: [{ embedding: sampleEmbedding }],
    });

    const result = await provider.generateEmbedding(inputText);

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: inputText,
    });
    expect(result.embedding).toEqual(sampleEmbedding);
    expect(result.dimensions).toBe(1536);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('text-embedding-3-small');
    expect(result.sourceTextHash).toBe(hashSourceText(inputText));
  });

  it('should throw when OpenAI client is not initialized', async () => {
    const unconfiguredModule: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAiEmbeddingProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(() => null),
          },
        },
      ],
    }).compile();

    const unconfiguredProvider =
      unconfiguredModule.get<OpenAiEmbeddingProvider>(OpenAiEmbeddingProvider);

    await expect(
      unconfiguredProvider.generateEmbedding('test query'),
    ).rejects.toThrow('OpenAI embedding client is not initialized');
  });

  it('should reject empty input text', async () => {
    await expect(provider.generateEmbedding('   ')).rejects.toThrow(
      'Embedding input text cannot be empty',
    );
  });

  it('should throw when embedding dimensions are unexpected', async () => {
    mockCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });

    await expect(
      provider.generateEmbedding('invalid dimensions'),
    ).rejects.toThrow('Expected 1536-dim embedding, received 3');
  });
});
