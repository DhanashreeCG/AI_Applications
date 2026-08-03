import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GenerateFlashcardsDto } from './dto/generate-flashcards.dto';
import { FlashcardOrchestratorService } from './services/flashcard-orchestrator.service';

@ApiTags('flashcards')
@Controller('flashcards')
export class FlashcardsController {
  constructor(
    private readonly orchestrator: FlashcardOrchestratorService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Generate rendering-ready flashcards from a user query + age group',
  })
  async generate(@Body() dto: GenerateFlashcardsDto) {
    return this.orchestrator.generate(dto);
  }
}
