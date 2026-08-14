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
        { count: 3, imageQuery: 'red apples', assetId: 'asset-id', imageUrl: 'http://localhost:3000/worksheets/assets/asset-id/image' },
      ],
    },
  })
  structure!: Record<string, unknown>;
}
