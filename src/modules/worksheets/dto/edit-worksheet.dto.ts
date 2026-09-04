import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EditWorksheetDto {
  @ApiPropertyOptional({
    example: 'instruction',
    description: 'Editable field name. Use fieldPath for nested fields.',
  })
  field?: string;

  @ApiPropertyOptional({
    example: 'items[0].imageQuery',
    description: 'Dot/bracket path to an editable field, e.g. items[0].label',
  })
  fieldPath?: string;

  @ApiProperty({
    example: 'Make this shorter and easier for a 4-year-old.',
  })
  instruction!: string;

  @ApiPropertyOptional({ example: 'IN' })
  countryCode?: string;

  @ApiPropertyOptional({
    description: 'Template id or slug. Required when editing a temp-generated worksheet.',
  })
  templateId?: string;

  @ApiPropertyOptional({
    description: 'In-memory structure for temp-generated worksheets (not yet persisted).',
  })
  structure?: Record<string, unknown>;
}

export class CorrectWorksheetGrammarDto {
  @ApiPropertyOptional({ example: 'IN' })
  countryCode?: string;

  @ApiPropertyOptional({
    description: 'Template id or slug. Required when correcting a temp-generated worksheet.',
  })
  templateId?: string;

  @ApiPropertyOptional({
    description: 'In-memory structure for temp-generated worksheets (not yet persisted).',
  })
  structure?: Record<string, unknown>;
}
