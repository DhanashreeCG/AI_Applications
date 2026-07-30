/**
 * Normalizes PEM private keys loaded from environment variables.
 * Handles escaped newlines, surrounding quotes, and single-line PEM blobs.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  key = key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (!key.includes('\n')) {
    key = key
      .replace(
        /-----BEGIN PRIVATE KEY-----/,
        '-----BEGIN PRIVATE KEY-----\n',
      )
      .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----')
      .replace(
        /-----BEGIN RSA PRIVATE KEY-----/,
        '-----BEGIN RSA PRIVATE KEY-----\n',
      )
      .replace(
        /-----END RSA PRIVATE KEY-----/,
        '\n-----END RSA PRIVATE KEY-----',
      );
  }

  return key.trim();
}

export function isValidPrivateKeyPem(key: string): boolean {
  return (
    (key.includes('-----BEGIN PRIVATE KEY-----') &&
      key.includes('-----END PRIVATE KEY-----')) ||
    (key.includes('-----BEGIN RSA PRIVATE KEY-----') &&
      key.includes('-----END RSA PRIVATE KEY-----'))
  );
}

export function assertValidPrivateKeyPem(key: string): void {
  if (!isValidPrivateKeyPem(key)) {
    throw new Error(
      'GOOGLE_DRIVE_PRIVATE_KEY is missing or truncated. Paste the full PEM on one line with \\n escapes, or set GOOGLE_DRIVE_CREDENTIALS_PATH to your service account JSON file.',
    );
  }
}
