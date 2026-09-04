import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReplayDlqDto } from './dto/replay-dlq.dto';
import { ReplayStuckDto } from './dto/replay-stuck.dto';
import { AssetPipelineService } from './services/asset-pipeline.service';

@ApiTags('pipeline')
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly assetPipeline: AssetPipelineService) {}

  @Post('dlq/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Replay a single DLQ / stuck ingestion file' })
  @ApiBody({ type: ReplayDlqDto })
  async replayDlqMessage(@Body() body: ReplayDlqDto) {
    const messageId = await this.assetPipeline.replayDlqMessage(body);
    return {
      messageId,
      status: 'replayed',
    };
  }

  @Post('replay-stuck')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bulk-replay files stuck in a status (STORED_IN_S3, METADATA_GENERATED, DEAD_LETTER, …)',
  })
  @ApiBody({ type: ReplayStuckDto })
  async replayStuck(@Body() body: ReplayStuckDto) {
    return this.assetPipeline.replayStuck(body);
  }
}
