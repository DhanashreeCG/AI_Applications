import { ApiProperty } from '@nestjs/swagger';
import { GenerateFlashcardsResponse } from '../interfaces/flashcard.interfaces';

export class RenderFlashcardsDto implements GenerateFlashcardsResponse {
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

  @ApiProperty({ type: Object })
  renderingMetadata!: GenerateFlashcardsResponse['renderingMetadata'];
}
