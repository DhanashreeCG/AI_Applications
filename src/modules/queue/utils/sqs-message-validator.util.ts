import { BaseSqsMessage } from '../../../common/interfaces/sqs-messages.interface';

export function isValidPipelineMessage(body: unknown): body is BaseSqsMessage {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const message = body as Record<string, unknown>;

  return (
    typeof message.jobId === 'string' &&
    message.jobId.length > 0 &&
    typeof message.ingestionFileId === 'string' &&
    message.ingestionFileId.length > 0 &&
    typeof message.attempt === 'number' &&
    message.attempt >= 1 &&
    typeof message.timestamp === 'string' &&
    message.timestamp.length > 0
  );
}
