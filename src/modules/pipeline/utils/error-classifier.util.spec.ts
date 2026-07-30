import { classifyProcessingError } from './error-classifier.util';

describe('classifyProcessingError', () => {
  it('should classify transient HTTP failures as retryable', () => {
    expect(classifyProcessingError(new Error('HTTP 503 Service Unavailable'))).toEqual(
      expect.objectContaining({
        retryable: true,
        errorCode: 'TRANSIENT_ERROR',
      }),
    );
  });

  it('should classify corrupted images as non-retryable', () => {
    expect(
      classifyProcessingError(new Error('Corrupted or invalid image file')),
    ).toEqual(
      expect.objectContaining({
        retryable: false,
        errorCode: 'NON_RETRYABLE_ERROR',
      }),
    );
  });
});
