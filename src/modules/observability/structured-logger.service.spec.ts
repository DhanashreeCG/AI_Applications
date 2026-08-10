import { StructuredLoggerService } from './structured-logger.service';

describe('StructuredLoggerService', () => {
  let logger: StructuredLoggerService;

  beforeEach(() => {
    logger = new StructuredLoggerService('TestContext');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should emit structured JSON logs with trace fields', () => {
    logger.log('Pipeline stage completed', {
      job_id: 'job-001',
      asset_id: 'asset-001',
      processing_stage: 'COMPLETED',
      duration_ms: 120,
      status: 'success',
    });

    expect(console.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String((console.log as jest.Mock).mock.calls[0][0]));

    expect(payload).toMatchObject({
      level: 'info',
      message: 'Pipeline stage completed',
      context: 'TestContext',
      job_id: 'job-001',
      asset_id: 'asset-001',
      processing_stage: 'COMPLETED',
      duration_ms: 120,
      status: 'success',
    });
    expect(payload.timestamp).toEqual(expect.any(String));
  });

  it('should include error details on error logs', () => {
    logger.error(
      'Pipeline stage failed',
      { asset_id: 'asset-001', status: 'failed' },
      new Error('S3 upload failed'),
    );

    expect(console.error).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String((console.error as jest.Mock).mock.calls[0][0]));

    expect(payload.level).toBe('error');
    expect(payload.error_message).toBe('S3 upload failed');
    expect(payload.stack_trace).toEqual(expect.any(String));
  });
});
