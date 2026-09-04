import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  FlashcardCardPayload,
  GenerateFlashcardsResponse,
} from '../interfaces/flashcard.interfaces';
import { SaveGeneratedFlashcardsDto } from '../dto/save-flashcards.dto';
import { asCards, persistableCards } from '../utils/flashcard-cards.util';

@Injectable()
export class FlashcardPersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  public async saveGenerated(
    payload: SaveGeneratedFlashcardsDto,
  ): Promise<GenerateFlashcardsResponse> {
    if (!payload.template?.id) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'template.id is required to save flashcards',
      );
    }
    if (!Array.isArray(payload.cards) || !payload.cards.length) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'cards are required to save flashcards',
      );
    }

    const template = await this.prisma.flashcardTemplate.findUnique({
      where: { id: payload.template.id },
      select: { id: true },
    });
    if (!template) {
      throw new FlashcardException(
        'NO_TEMPLATE_FOUND',
        `Template "${payload.template.id}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const metadata = payload.metadata ?? payload.renderingMetadata;
    if (!metadata) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'metadata is required to save flashcards',
      );
    }
    const cards = persistableCards(payload.cards);
    const data = {
      templateId: payload.template.id,
      request: payload.request as unknown as Prisma.InputJsonValue,
      selection: payload.selection as unknown as Prisma.InputJsonValue,
      templateSnapshot: payload.template as unknown as Prisma.InputJsonValue,
      templateVersion: payload.templateVersion,
      layoutDefinition: payload.layoutDefinition as unknown as Prisma.InputJsonValue,
      cards: cards as unknown as Prisma.InputJsonValue,
      metadata: metadata as unknown as Prisma.InputJsonValue,
      renderedOutput: (payload.renderedOutput ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
      status: 'GENERATED' as const,
    };

    const existingId = payload.id?.trim();
    if (existingId) {
      await this.requireSet(existingId);
      const updated = await this.prisma.flashcardSet.update({
        where: { id: existingId },
        data,
      });
      return this.toResponse(updated);
    }

    const row = await this.prisma.flashcardSet.create({ data });

    return this.toResponse(row);
  }

  public async getById(flashcardSetId: string): Promise<GenerateFlashcardsResponse> {
    const row = await this.requireSet(flashcardSetId);
    return this.toResponse(row);
  }

  public async updateCards(
    flashcardSetId: string,
    cards: FlashcardCardPayload[],
  ): Promise<GenerateFlashcardsResponse> {
    const updated = await this.prisma.flashcardSet.update({
      where: { id: flashcardSetId },
      data: { cards: persistableCards(cards) as unknown as Prisma.InputJsonValue },
    });
    return this.toResponse(updated);
  }

  public async requireSet(flashcardSetId: string) {
    const row = await this.prisma.flashcardSet.findUnique({
      where: { id: flashcardSetId },
    });
    if (!row) {
      throw new FlashcardException(
        'FLASHCARD_NOT_FOUND',
        `Flashcard set "${flashcardSetId}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  public toResponse(row: {
    id: string;
    status: string;
    request: unknown;
    selection: unknown;
    templateSnapshot: unknown;
    templateVersion: string;
    layoutDefinition: unknown;
    cards: unknown;
    metadata: unknown;
    renderedOutput: unknown;
  }): GenerateFlashcardsResponse {
    const metadata = (row.metadata ?? {}) as GenerateFlashcardsResponse['metadata'];
    return {
      id: row.id,
      status: row.status,
      request: row.request as GenerateFlashcardsResponse['request'],
      selection: row.selection as GenerateFlashcardsResponse['selection'],
      template: row.templateSnapshot as GenerateFlashcardsResponse['template'],
      templateVersion: row.templateVersion,
      layoutDefinition:
        row.layoutDefinition as GenerateFlashcardsResponse['layoutDefinition'],
      cards: asCards(row.cards),
      metadata,
      renderingMetadata: metadata,
      renderedOutput:
        (row.renderedOutput as GenerateFlashcardsResponse['renderedOutput']) ||
        undefined,
    };
  }
}
