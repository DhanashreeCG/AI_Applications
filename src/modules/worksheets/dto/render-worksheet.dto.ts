import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RenderWorksheetDto {
  @ApiProperty({
    enum: ['html', 'webp', 'png', 'pdf'],
    example: 'png',
    description:
      'html returns the same markup used for preview/export. webp/png/pdf are Playwright captures of export-mode HTML.',
  })
  format!: 'html' | 'webp' | 'png' | 'pdf';

  @ApiPropertyOptional({
    enum: ['editor', 'export'],
    example: 'export',
    description:
      'html only. editor exposes edit/image controls; export hides them. webp/pdf always use export.',
  })
  mode?: 'editor' | 'export';
}
