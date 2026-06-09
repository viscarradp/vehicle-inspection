import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        statusCode: 'UNAUTHORIZED',
        message: 'No autenticado.',
        uiState: 'unauthorized',
      });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        statusCode: 'FORBIDDEN',
        message: 'No tiene permisos para realizar esta acción.',
        uiState: 'unauthorized',
      });
      return;
    }
    next();
  };
}
