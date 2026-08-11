import { isValidPipelineMessage } from './sqs-message-validator.util';

describe('isValidPipelineMessage', () => {
  it('accepts valid pipeline messages', () => {
    expect(
      isValidPipelineMessage({
        jobId: 'job-001',
        ingestionFileId: 'file-001',
        attempt: 1,
        timestamp: '2026-07-30T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects malformed pipeline messages', () => {
    expect(isValidPipelineMessage({ jobId: 'job-001' })).toBe(false);
    expect(isValidPipelineMessage(null)).toBe(false);
  });
});
