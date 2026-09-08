/** Which OpenAI API key to bill for an embedding call. */
export type EmbeddingBillingScope = 'platform' | 'flashcards' | 'worksheets';

export interface EmbeddingCallOptions {
  /**
   * - platform: OPENAI_API_KEY (asset ingestion + default search API)
   * - flashcards: FLASHCARD_OPENAI_API_KEY
   * - worksheets: WORKSHEET_OPENAI_API_KEY
   */
  billingScope?: EmbeddingBillingScope;
}

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  provider: string;
  model: string;
  sourceTextHash: string;
}

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly dimensions: number;

  generateEmbedding(
    text: string,
    options?: EmbeddingCallOptions,
  ): Promise<EmbeddingResult>;
  generateEmbeddings(
    texts: string[],
    options?: EmbeddingCallOptions,
  ): Promise<EmbeddingResult[]>;
}
