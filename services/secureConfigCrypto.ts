import crypto from 'crypto';

// Read secret at request time so dotenv has loaded before we use it.
function getSmtpConfigEncryptionSecret(): string {
  return process.env.SMTP_PASSWORD_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
}

function deriveAesKey(secret: string): Buffer | null {
  const normalized = String(secret || '').trim();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest();
}

function getEncryptionKeyOrThrow(): Buffer {
  const key = deriveAesKey(getSmtpConfigEncryptionSecret());
  if (!key) {
    throw new Error('Missing SMTP_PASSWORD_ENCRYPTION_KEY/JWT_SECRET for SMTP secret encryption');
  }
  return key;
}

export function encryptConfigSecret(value: string): string {
  const plaintext = String(value || '');
  if (!plaintext) {
    throw new Error('Cannot encrypt an empty secret');
  }

  const key = getEncryptionKeyOrThrow();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]).toString('base64url');
  return `enc:${packed}`;
}

export function decryptConfigSecret(value: string): string {
  const stored = String(value || '');
  if (!stored) return '';
  if (!stored.startsWith('enc:')) return stored;

  const key = getEncryptionKeyOrThrow();
  const raw = Buffer.from(stored.slice('enc:'.length), 'base64url');

  if (raw.length < 12 + 16 + 1) {
    throw new Error('Invalid encrypted SMTP secret payload');
  }

  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
