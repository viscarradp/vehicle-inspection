import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { AuthUser } from '@/types';
import { authApi } from '@/api/endpoints';
import { authEvents } from '@/api/client';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  // Helpers derivados del rol
  isGuard: boolean;
  isOpsChief: boolean;
  canManageFleet: boolean;
  canManageUsers: boolean;
  isCountryScope: boolean;       // admin_pais o admin_global (sin branchId)
  isGlobalAdmin: boolean;
  canModifyAfterSubmit: boolean;
  canManageStatusTypes: boolean; // admin_pais o admin_global
  canManageSettings:   boolean; // admin, admin_pais, admin_global
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Al montar: verificar sesión activa vía cookie HttpOnly
  useEffect(() => {
    authApi.me()
      .then(r => setUser(r.data.data as AuthUser))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Escucha el evento 'unauthorized' emitido por el interceptor de Axios cuando
  // cualquier request recibe un 401 post-carga (sesión expirada en mitad del uso).
  // Limpiar el usuario deja que React Router redirija a /login sin hard-reload.
  useEffect(() => {
    const handleUnauthorized = () => setUser(null);
    authEvents.addEventListener('unauthorized', handleUnauthorized);
    return () => authEvents.removeEventListener('unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<AuthUser> => {
    await authApi.login(username, password);
    const meRes = await authApi.me();
    const userData = meRes.data.data as AuthUser;
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    setUser(null);
  }, []);

  const role = user?.role ?? '';

  const value: AuthContextValue = {
    user,
    loading,
    login,
    logout,
    isGuard:              role === 'guardia',
    isOpsChief:           role === 'jefe_operaciones',
    canManageFleet:       ['admin', 'admin_pais', 'admin_global'].includes(role),
    canManageUsers:       ['admin', 'admin_pais', 'admin_global'].includes(role),
    isCountryScope:       ['admin_pais', 'admin_global'].includes(role),
    isGlobalAdmin:        role === 'admin_global',
    canModifyAfterSubmit: ['jefe_operaciones', 'admin', 'admin_pais', 'admin_global'].includes(role),
    canManageStatusTypes: ['admin_pais', 'admin_global'].includes(role),
    canManageSettings:   ['admin', 'admin_pais', 'admin_global'].includes(role),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
