import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { Login }      from '@/pages/Login';
import { Dashboard }  from '@/pages/Dashboard';
import { OpsShell }   from '@/components/layouts/OpsShell';

// ─── Redirector raíz ─────────────────────────────────────────────────────────
function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'guardia') return <Navigate to="/guard" replace />;
  return <Navigate to="/ops" replace />;
}

// ─── Guard para ruta /guard (solo guardia) ────────────────────────────────────
function GuardRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'guardia') return <Navigate to="/ops" replace />;
  return <Dashboard />;
}

// ─── Guard para rutas /ops/* (todos los roles admin) ─────────────────────────
function OpsRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'guardia') return <Navigate to="/guard" replace />;
  return <OpsShell />;
}

// ─── Login route (redirige si ya está autenticado) ───────────────────────────
function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <RootRedirect />;
  return <Login />;
}

// ─── Splash de carga inicial ──────────────────────────────────────────────────
function LoadingSplash() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// ─── Árbol de rutas ───────────────────────────────────────────────────────────
function AppRoutes() {
  const { loading } = useAuth();

  if (loading) return <LoadingSplash />;

  return (
    <Routes>
      <Route path="/login"  element={<LoginRoute />} />
      <Route path="/guard"  element={<GuardRoute />} />
      <Route path="/ops/*"  element={<OpsRoute />} />
      <Route path="*"       element={<RootRedirect />} />
    </Routes>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3500,
            style: {
              borderRadius: '10px',
              fontSize: '14px',
              fontFamily: 'Inter, system-ui, sans-serif',
              background: '#fff',
              color: '#111',
              border: '1.5px solid #e2e8f0',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            },
          }}
        />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
