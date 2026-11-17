import SHA256 from 'crypto-js/sha256';

/**
 * Hash a password using SHA-256
 * This is used for client-side password hashing before storing in database
 */
export function hashPassword(password: string): string {
  return SHA256(password).toString();
}

/**
 * Verify a password by comparing hashes
 */
export function verifyPassword(plainTextPassword: string, hashedPassword: string): boolean {
  const hashedInput = hashPassword(plainTextPassword.trim());
  return hashedInput === hashedPassword.trim();
}
