import { Injectable } from '@nestjs/common';
import { OtelAdapter } from '../interfaces/pipeline-tracker.interface';

/** No-op until OpenTelemetry is added to the project. */
@Injectable()
export class NoopOtelAdapter implements OtelAdapter {
  public attachContext(_executionId: string, _correlationId: string): void {
    // intentionally empty
  }
}
