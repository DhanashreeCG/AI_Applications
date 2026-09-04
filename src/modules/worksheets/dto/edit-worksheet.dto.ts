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
}
