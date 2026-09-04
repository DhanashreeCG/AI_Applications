import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RenderWorksheetDto {
  @ApiProperty({
    enum: ['html', 'webp', 'pdf'],
    example: 'pdf',
    description:
      'html returns the same markup used for preview/export. webp/pdf are Playwright captures of export-mode HTML.',
  })
  format!: 'html' | 'webp' | 'pdf';

  @ApiPropertyOptional({
    enum: ['editor', 'export'],
    example: 'export',
    description:
      'html only. editor exposes edit/image controls; export hides them. webp/pdf always use export.',
  })
  mode?: 'editor' | 'export';
}
