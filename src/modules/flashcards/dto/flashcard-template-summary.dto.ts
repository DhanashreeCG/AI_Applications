import { ApiProperty } from '@nestjs/swagger';

export class FlashcardTemplateSummaryDto {
  @ApiProperty({ example: 'clxyz123' })
  id!: string;

  @ApiProperty({ example: 'Large Image + Single Word' })
  name!: string;

  @ApiProperty({ example: 'flashcard' })
  templateType!: string;

  @ApiProperty({ example: 'VERTICAL' })
  layoutType!: string;
}

export class ListFlashcardTemplatesResponseDto {
  @ApiProperty({ type: [FlashcardTemplateSummaryDto] })
  templates!: FlashcardTemplateSummaryDto[];
}
