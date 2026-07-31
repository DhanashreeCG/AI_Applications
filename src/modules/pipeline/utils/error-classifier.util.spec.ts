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
        errorCode: 'VALIDATION_ERROR',
      }),
    );
  });

  it('should classify auth failures as non-retryable', () => {
    expect(classifyProcessingError(new Error('HTTP 401 Unauthorized'))).toEqual(
      expect.objectContaining({
        retryable: false,
        errorCode: 'AUTH_ERROR',
      }),
    );
  });

  it('should classify circuit open as retryable rate limit', () => {
    expect(
      classifyProcessingError(
        new Error('Circuit open for google-gemini; retry after 5000ms (429/transient)'),
      ),
    ).toEqual(
      expect.objectContaining({
        retryable: true,
        errorCode: 'RATE_LIMITED',
      }),
    );
  });
});
