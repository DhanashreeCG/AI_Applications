import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { DlqMessage } from '../../common/interfaces/sqs-messages.interface';
import { AssetPipelineService } from './services/asset-pipeline.service';

@Controller('pipeline')
export class PipelineController {
  constructor(private readonly assetPipeline: AssetPipelineService) {}

  @Post('dlq/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  async replayDlqMessage(@Body() message: DlqMessage) {
    const messageId = await this.assetPipeline.replayDlqMessage(message);
    return {
      messageId,
      status: 'replayed',
    };
  }
}
