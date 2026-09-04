import {
  AssetReference,
  EditableComponentPayload,
  FlashcardCardPayload,
} from '../interfaces/flashcard.interfaces';

export function cloneCards(cards: FlashcardCardPayload[]): FlashcardCardPayload[] {
  return JSON.parse(JSON.stringify(cards)) as FlashcardCardPayload[];
}

export function persistableCards(
  cards: FlashcardCardPayload[],
): FlashcardCardPayload[] {
  return cards.map((card) => ({
    ...card,
    components: card.components.map((component) => ({
      ...component,
      assetReference: persistableAssetReference(component.assetReference),
    })),
  }));
}

export function persistableAssetReference(
  reference: AssetReference | null | undefined,
): AssetReference | null {
  if (!reference) {
    return null;
  }
  return {
    ...reference,
    signedUrl: null,
    imageUrl: reference.userUploadedKey
      ? reference.imageUrl
      : reference.assetId
        ? `/flashcards/assets/${reference.assetId}/image`
        : reference.imageUrl,
  };
}

export function findCard(
  cards: FlashcardCardPayload[],
  cardId: string,
): FlashcardCardPayload | undefined {
  return cards.find((card) => card.cardId === cardId);
}

export function findComponent(
  card: FlashcardCardPayload,
  componentId: string,
): EditableComponentPayload | undefined {
  return card.components.find(
    (component) => component.componentId === componentId,
  );
}

export function asCards(value: unknown): FlashcardCardPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as FlashcardCardPayload[];
}
