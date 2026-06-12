import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { findUserByUsername, updateLastLogin, getKioskUsers } from '../db/users';

// Pre-computed once at load. Compared against when a username is unknown so the
// failure path costs the same bcrypt work as a real login — login latency can't
// be used to enumerate valid usernames.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('login-timing-equalizer', 12);

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({
        success: false,
        statusCode: 'MISSING_CREDENTIALS',
        message: 'Usuario y contraseña son requeridos.',
        uiState: 'validation_error',
      });
      return;
    }

    const user = await findUserByUsername(username.trim().toLowerCase());

    // Always run a bcrypt comparison — against a dummy hash when the user does
    // not exist — so the response time is the same whether or not the username
    // is valid (prevents timing-based user enumeration).
    const passwordMatch = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!user || !user.active || !passwordMatch) {
      res.status(401).json({
        success: false,
        statusCode: 'INVALID_CREDENTIALS',
        message: 'Usuario o contraseña incorrectos.',
        uiState: 'validation_error',
      });
      return;
    }

    const payload = {
      userId:    String(user.id),
      username:  user.username,
      role:      user.role,
      fullName:  user.fullName,
      branchId:  user.branchId  ?? undefined,
      countryId: user.countryId ?? undefined,
    };

    // Rechazar login si el usuario está mal configurado para su rol
    const needsBranch  = ['guardia', 'jefe_operaciones', 'admin'].includes(user.role);
    const needsCountry = user.role === 'admin_pais';

    if (needsBranch && !payload.branchId) {
      res.status(403).json({
        success: false,
        statusCode: 'USER_MISCONFIGURED',
        message: `El usuario '${user.username}' no tiene sucursal asignada. Contacte al administrador global.`,
        uiState: 'validation_error',
      });
      return;
    }

    if (needsCountry && !payload.countryId) {
      res.status(403).json({
        success: false,
        statusCode: 'USER_MISCONFIGURED',
        message: `El usuario '${user.username}' no tiene país asignado. Contacte al administrador global.`,
        uiState: 'validation_error',
      });
      return;
    }

    const expiresIn = (process.env.JWT_EXPIRES_IN ?? '12h') as jwt.SignOptions['expiresIn'];
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn });

    await updateLastLogin(String(user.id), new Date().toISOString());

    const isHttps = (process.env.PUBLIC_BASE_URL ?? '').startsWith('https://');
    // Parse expiresIn to ms for the cookie maxAge (supports '12h', '7d', '30m', plain seconds)
    const expiresInStr = String(process.env.JWT_EXPIRES_IN ?? '12h');
    const unit = expiresInStr.slice(-1);
    const value = parseInt(expiresInStr, 10);
    const multipliers: Record<string, number> = { h: 3600, d: 86400, m: 60, s: 1 };
    const maxAgeSeconds = (multipliers[unit] ?? 1) * (isNaN(value) ? 43200 : value);

    res.cookie('vi_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'strict' : 'lax',
      maxAge: maxAgeSeconds * 1000,
      path: '/',
    });

    res.json({
      success: true,
      statusCode: 'LOGIN_SUCCESS',
      message: `Bienvenido, ${user.fullName}.`,
      uiState: 'saved_successfully',
      data: { user: payload },
    });
  } catch (err) {
    next(err);
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie('vi_token', { path: '/' });
  res.json({
    success: true,
    statusCode: 'LOGOUT_SUCCESS',
    message: 'Sesión cerrada correctamente.',
    uiState: 'saved_successfully',
  });
}

export function me(req: Request, res: Response): void {
  res.json({
    success: true,
    statusCode: 'OK',
    message: 'Perfil de usuario.',
    uiState: 'saved_successfully',
    data: req.user,
  });
}

export async function guards(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await getKioskUsers();
    res.json({
      success: true,
      statusCode: 'OK',
      message: '',
      uiState: 'saved_successfully',
      data: users,
    });
  } catch (err) {
    next(err);
  }
}
