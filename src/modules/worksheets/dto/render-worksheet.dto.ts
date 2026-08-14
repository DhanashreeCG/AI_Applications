import { ApiProperty } from '@nestjs/swagger';

export class RenderWorksheetDto {
  @ApiProperty({
    enum: ['html', 'webp', 'pdf'],
    example: 'pdf',
    description: 'Output format. html returns markup; webp/pdf are stored and returned as URIs.',
  })
  format!: 'html' | 'webp' | 'pdf';
}
