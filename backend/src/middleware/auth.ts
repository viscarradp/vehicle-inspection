import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types';
import { setTenantContext } from '../db/connection';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.vi_token as string | undefined;

  if (!token) {
    res.status(401).json({
      success: false,
      statusCode: 'UNAUTHORIZED',
      message: 'Token de autenticación requerido.',
      uiState: 'unauthorized',
    });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    req.user = payload;
    // Set SESSION_CONTEXT on the current request's transaction so RLS
    // policies can filter rows by the user's scope (branch / country / global).
    setTenantContext(payload).then(() => next()).catch(next);
  } catch {
    res.status(401).json({
      success: false,
      statusCode: 'INVALID_TOKEN',
      message: 'Sesión expirada o inválida. Por favor inicie sesión nuevamente.',
      uiState: 'unauthorized',
    });
  }
}
