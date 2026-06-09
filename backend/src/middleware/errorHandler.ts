import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      statusCode: err.code,
      message: err.message,
      uiState: err.statusCode === 404 ? 'not_found' : 'server_error',
    });
    return;
  }

  // Log full error server-side but never expose stack traces to clients
  console.error('[ERROR]', {
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    name: err.name,
  });
  res.status(500).json({
    success: false,
    statusCode: 'INTERNAL_ERROR',
    message: 'Error interno del servidor.',
    uiState: 'server_error',
  });
}
