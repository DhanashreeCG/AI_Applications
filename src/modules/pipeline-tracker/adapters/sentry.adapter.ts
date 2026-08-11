import { Injectable } from '@nestjs/common';
import { SentryAdapter } from '../interfaces/pipeline-tracker.interface';

/** No-op until Sentry is added to the project. */
@Injectable()
export class NoopSentryAdapter implements SentryAdapter {
  public setContext(_fields: {
    executionId?: string;
    stage?: string;
    requestId?: string;
    templateId?: string;
    ageGroup?: string;
    topic?: string;
  }): void {
    // intentionally empty
  }
}
