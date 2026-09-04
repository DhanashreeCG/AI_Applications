import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GenerateFlashcardsResponse } from '../interfaces/flashcard.interfaces';

export class SaveGeneratedFlashcardsDto {
  @ApiPropertyOptional()
  id?: string;

  @ApiProperty({ type: Object })
  request!: GenerateFlashcardsResponse['request'];

  @ApiProperty({ type: Object })
  selection!: GenerateFlashcardsResponse['selection'];

  @ApiProperty({ type: Object })
  template!: GenerateFlashcardsResponse['template'];

  @ApiProperty()
  templateVersion!: string;

  @ApiProperty({ type: Object })
  layoutDefinition!: GenerateFlashcardsResponse['layoutDefinition'];

  @ApiProperty({ type: Array })
  cards!: GenerateFlashcardsResponse['cards'];

  @ApiProperty({ type: Object })
  metadata!: GenerateFlashcardsResponse['metadata'];

  @ApiPropertyOptional({ type: Object })
  renderingMetadata?: GenerateFlashcardsResponse['renderingMetadata'];

  @ApiPropertyOptional({ type: Object })
  renderedOutput?: GenerateFlashcardsResponse['renderedOutput'];
}

export class SaveFlashcardFieldDto {
  @ApiProperty({ example: 'card_abc' })
  cardId!: string;

  @ApiProperty({ example: 'title' })
  componentId!: string;

  @ApiProperty({ example: 'Apple' })
  value!: unknown;
}

export class SaveFlashcardImageDto {
  @ApiProperty({ example: 'card_abc' })
  cardId!: string;

  @ApiProperty({ example: 'hero-image' })
  componentId!: string;

  @ApiPropertyOptional({
    example: 'classet0001',
    description: 'Library asset id. Null when the slot uses a user upload.',
    nullable: true,
  })
  assetId?: string | null;

  @ApiPropertyOptional({
    example: 'flashcards/uploads/fc-1/abc.png',
    description: 'S3 object key for a user-uploaded image',
  })
  userUploadedKey?: string;
}

export class SaveFlashcardEditsDto {
  @ApiPropertyOptional({ type: [SaveFlashcardFieldDto] })
  fields?: SaveFlashcardFieldDto[];

  @ApiPropertyOptional({ type: [SaveFlashcardImageDto] })
  images?: SaveFlashcardImageDto[];
}
