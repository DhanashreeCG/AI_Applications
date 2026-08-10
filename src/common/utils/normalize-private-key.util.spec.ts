import {
  assertValidPrivateKeyPem,
  isValidPrivateKeyPem,
  normalizePrivateKey,
} from './normalize-private-key.util';

const SAMPLE_PEM =
  '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC\n-----END PRIVATE KEY-----';

describe('normalizePrivateKey', () => {
  it('preserves already-normalized PEM', () => {
    expect(normalizePrivateKey(SAMPLE_PEM)).toBe(SAMPLE_PEM);
  });

  it('converts escaped newlines from env files', () => {
    const escaped = SAMPLE_PEM.replace(/\n/g, '\\n');
    expect(normalizePrivateKey(escaped)).toBe(SAMPLE_PEM);
  });

  it('strips surrounding quotes', () => {
    expect(normalizePrivateKey(`"${SAMPLE_PEM.replace(/\n/g, '\\n')}"`)).toBe(
      SAMPLE_PEM,
    );
  });

  it('inserts newlines for single-line PEM blobs', () => {
    const singleLine = SAMPLE_PEM.replace(/\n/g, '');
    expect(normalizePrivateKey(singleLine)).toBe(SAMPLE_PEM);
  });
});

describe('isValidPrivateKeyPem', () => {
  it('accepts valid PEM', () => {
    expect(isValidPrivateKeyPem(SAMPLE_PEM)).toBe(true);
  });

  it('rejects truncated PEM', () => {
    expect(isValidPrivateKeyPem('-----BEGIN PRIVATE KEY-----')).toBe(false);
  });
});

describe('assertValidPrivateKeyPem', () => {
  it('throws for invalid PEM', () => {
    expect(() => assertValidPrivateKeyPem('invalid')).toThrow(/truncated/i);
  });
});
