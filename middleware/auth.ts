import jwt from 'jsonwebtoken';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, JWTPayload, AuthErrorResponse } from '../types/index.js';
import { getJwtSecret } from '../utils/authHelpers.js';

export const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response<AuthErrorResponse>,
  next: NextFunction
): void => {
  try {
    const authHeader: string = req.headers.authorization || '';
    const token: string | null = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      res.status(401).json({
        success: false,
        status: 'error',
        error: 'Authentication token missing',
      });
      return;
    }

    const payload: JWTPayload = jwt.verify(token, getJwtSecret()) as JWTPayload;
    req.user = payload;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      status: 'error',
      error: 'Invalid or expired token',
    });
  }
};



