import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DlqMessage } from '../../common/interfaces/pipeline-messages.interface';
import { AssetPipelineService } from './services/asset-pipeline.service';

@ApiTags('pipeline')
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly assetPipeline: AssetPipelineService) {}

  @Post('dlq/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Replay a DLQ message to its stage queue' })
  async replayDlqMessage(@Body() message: DlqMessage) {
    const messageId = await this.assetPipeline.replayDlqMessage(message);
    return {
      messageId,
      status: 'replayed',
    };
  }
}
