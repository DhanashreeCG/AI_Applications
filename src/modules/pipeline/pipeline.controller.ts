import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReplayDlqDto } from './dto/replay-dlq.dto';
import { AssetPipelineService } from './services/asset-pipeline.service';

@ApiTags('pipeline')
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly assetPipeline: AssetPipelineService) {}

  @Post('dlq/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Replay a DLQ message to its stage queue' })
  @ApiBody({ type: ReplayDlqDto })
  async replayDlqMessage(@Body() body: ReplayDlqDto) {
    const messageId = await this.assetPipeline.replayDlqMessage(body);
    return {
      messageId,
      status: 'replayed',
    };
  }
}
