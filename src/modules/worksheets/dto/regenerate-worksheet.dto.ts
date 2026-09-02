import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegenerateWorksheetDto {
  @ApiProperty({
    example: 'Make the questions about farm animals and keep the same age group.',
    description: 'Requirements for regenerating this worksheet on the same template',
  })
  query!: string;

  @ApiPropertyOptional({ example: 'Farm animals' })
  topic?: string;

  @ApiPropertyOptional({ example: 'IN' })
  countryCode?: string;

  @ApiPropertyOptional({ example: '4-5' })
  ageGroup?: string;

  @ApiPropertyOptional({ example: 5 })
  age?: number;

  @ApiPropertyOptional({
    description: 'Template id or slug. Required for temp-generated worksheets.',
  })
  templateId?: string;

  @ApiPropertyOptional({
    description: 'Structured AI Edit form values (topic, q1, theme, …).',
    example: { topic: 'Vegetables', q1: 'Make about washing vegetables' },
  })
  fields?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Current in-memory structure for temp-generated worksheets.',
  })
  structure?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Original generate request (age group, grade, language).',
  })
  request?: Record<string, unknown>;
}
