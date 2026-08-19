import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EditFlashcardDto {
  @ApiProperty({ example: 'card_abc' })
  cardId!: string;

  @ApiProperty({ example: 'title' })
  componentId!: string;

  @ApiProperty({
    example: 'Make this shorter and easier for a 4-year-old.',
  })
  instruction!: string;

  @ApiPropertyOptional({
    example: 'IN',
    description:
      'ISO 3166-1 alpha-2 country code for region-specific content restrictions',
  })
  countryCode?: string;
}

export class SearchFlashcardImagesQueryDto {
  @ApiPropertyOptional({ example: 'red apple on a white background' })
  query?: string;

  @ApiPropertyOptional({ example: 'card_abc' })
  cardId?: string;

  @ApiPropertyOptional({
    example: 'hero-image',
    description: 'Image component id; used to default query from queryUsed when query is omitted',
  })
  componentId?: string;

  @ApiPropertyOptional({ example: 10 })
  limit?: number;
}

export class DownloadFlashcardDto {
  @ApiProperty({
    enum: ['pdf', 'png', 'webp'],
    example: 'pdf',
    description: 'Playwright capture of the same UI card markup used in flashcards.html.',
  })
  format!: 'pdf' | 'png' | 'webp';

  @ApiPropertyOptional({
    example: 0,
    description: 'Card index for png/webp. Omit for the full PDF set.',
  })
  cardIndex?: number;
}
