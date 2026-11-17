import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, AuthErrorResponse } from '../types/index.js';

export const adminOnlyMiddleware = (
  req: AuthenticatedRequest,
  res: Response<AuthErrorResponse>,
  next: NextFunction
): void => {
  if (req.userRole !== 'admin' && req.userRole !== 'owner') {
    res.status(403).json({
      success: false,
      status: 'error',
      error: 'Access denied: Admin privileges required',
    });
    return;
  }
  next();
};



