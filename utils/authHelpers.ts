import SHA256 from 'crypto-js/sha256.js';
import { timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { JWTPayload } from '../types/index.js';

export const hashPassword = (password: string): string => {
  return SHA256(password).toString();
};

export const verifyPassword = (plainTextPassword: string, hashedPassword: string): boolean => {
  if (!hashedPassword) return false;
  const hashedInput: string = hashPassword(plainTextPassword.trim());
  const supplied = Buffer.from(hashedInput);
  const stored = Buffer.from(hashedPassword.trim());
  return supplied.length === stored.length && timingSafeEqual(supplied, stored);
};

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  throw new Error('JWT_SECRET is required');
};

export const generateEventId = (): string => {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const toCamelCase = (str: string): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match: string, chr: string) => chr.toUpperCase())
    .replace(/^[A-Z]/, (chr: string) => chr.toLowerCase());
};

export const generateToken = (user: JWTPayload): string => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
};

