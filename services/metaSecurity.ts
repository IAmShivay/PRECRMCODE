import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export class MetaIntegrationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function signingKey(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new MetaIntegrationError('Integration signing key is not configured', 503);
  return secret;
}

export function signMetaState(purpose: string, data: Record<string, unknown>, expiresIn = 600): string {
  return jwt.sign(data, signingKey(), { algorithm: 'HS256', audience: purpose, expiresIn, jwtid: crypto.randomUUID() });
}

export function verifyMetaState<T>(token: string, purpose: string): T {
  try {
    return jwt.verify(token, signingKey(), { algorithms: ['HS256'], audience: purpose }) as T;
  } catch {
    throw new MetaIntegrationError('This connection request has expired. Please connect again.');
  }
}

export function decodeMetaSignedRequest(raw: string, secret: string): { user_id: string } {
  if (!secret) throw new MetaIntegrationError('Integration is not configured', 503);
  const parts = raw.split('.');
  const [signature, payload] = parts;
  if (parts.length !== 2 || !signature || !payload) throw new MetaIntegrationError('Invalid signed request');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    throw new MetaIntegrationError('Invalid signed request');
  }
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (decoded.algorithm !== 'HMAC-SHA256' || !/^\d+$/.test(String(decoded.user_id || ''))) {
    throw new MetaIntegrationError('Invalid signed request');
  }
  return { user_id: String(decoded.user_id) };
}

export function publicAppOrigin(): string {
  const url = new URL(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000');
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new MetaIntegrationError('A secure public application URL is required', 503);
  }
  return url.origin;
}
