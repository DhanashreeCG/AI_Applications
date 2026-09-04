import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateWorksheetDto {
  @ApiPropertyOptional({
    example: 'Make a counting worksheet with fruit for LKG',
    description: 'Natural-language request. Optional when topic/grade are provided.',
  })
  query?: string;

  @ApiPropertyOptional({ example: 'LKG' })
  grade?: string;

  @ApiPropertyOptional({ example: 5, description: 'Learner age in years' })
  age?: number;

  @ApiPropertyOptional({ example: '5-6' })
  ageGroup?: string;

  @ApiPropertyOptional({ example: 'Math' })
  subject?: string;

  @ApiPropertyOptional({ example: 'Counting' })
  topic?: string;

  @ApiPropertyOptional({ example: 'easy' })
  difficulty?: string;

  @ApiPropertyOptional({ example: 'English' })
  language?: string;

  @ApiPropertyOptional({
    example: 'counting_objects_v1',
    description: 'Template id or slug. When set, skips deterministic selection.',
  })
  templateId?: string;

  @ApiPropertyOptional({
    example: 'IN',
    description:
      'ISO country code for content restrictions. Overrides FLASHCARD_DEFAULT_COUNTRY_CODE.',
  })
  countryCode?: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'How many worksheets to generate. Defaults to WORKSHEET_GENERATE_COUNT_DEFAULT (1).',
  })
  count?: number;
}

export class GenerateWorksheetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({
    example: {
      id: 'tmpl_1',
      slug: 'counting_objects_v1',
      name: 'Counting Objects',
      rendererType: 'generic',
    },
  })
  template!: {
    id: string;
    slug: string;
    name: string;
    rendererType: string;
  };

  @ApiProperty({ type: Object })
  request!: Record<string, unknown>;

  @ApiProperty({
    example: {
      instruction: 'Count the objects.',
      items: [
        { count: 3, imageQuery: 'red apples', assetId: 'asset-id' },
      ],
    },
  })
  structure!: Record<string, unknown>;
}
