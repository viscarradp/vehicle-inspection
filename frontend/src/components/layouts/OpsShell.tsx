import { NavLink, Routes, Route, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  AlertTriangle,
  ClipboardList,
  Car,
  IdCard,
  Users,
  LogOut,
  ChevronRight,
  Tag,
  Settings2,
  Activity,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';

import { useAuth }                    from '@/context/AuthContext';
import { OpsCenter }                   from '@/pages/ops/OpsCenter';
import { IssuesPage }                  from '@/pages/ops/IssuesPage';
import { ReportsPage }                 from '@/pages/ops/ReportsPage';
import { FleetMonitorPage }            from '@/pages/ops/FleetMonitorPage';
import { FleetPage }                   from '@/pages/ops/FleetPage';
import { DriversPage }                 from '@/pages/ops/DriversPage';
import { UsersPage }                   from '@/pages/ops/UsersPage';
import { VehicleStatusTypesPage }      from '@/pages/ops/VehicleStatusTypesPage';
import { SettingsPage }                from '@/pages/ops/SettingsPage';
import { cn }                          from '@/lib/utils';

// ─── Tipos de nav ─────────────────────────────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  jefe_operaciones: 'Jefe de Operaciones',
  admin:            'Administrador',
  admin_pais:       'Admin País',
  admin_global:     'Admin Global',
};

// ─── OpsShell ─────────────────────────────────────────────────────────────────

export function OpsShell() {
  const { user, logout, canManageFleet, canManageUsers, canManageStatusTypes, canManageSettings } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Nav items visibles según rol
  const navItems: NavItem[] = [
    { to: '/ops',               label: 'Centro de Operaciones', icon: LayoutDashboard, end: true },
    { to: '/ops/issues',        label: 'Daños abiertos',        icon: AlertTriangle },
    { to: '/ops/reports',       label: 'Reportes',              icon: ClipboardList },
    { to: '/ops/fleet-monitor', label: 'Estado de flota',       icon: Activity },
    ...(canManageFleet        ? [{ to: '/ops/fleet',         label: 'Flota',             icon: Car  }] : []),
    ...(canManageFleet        ? [{ to: '/ops/drivers',       label: 'Conductores',       icon: IdCard }] : []),
    ...(canManageUsers        ? [{ to: '/ops/users',         label: 'Usuarios',          icon: Users }] : []),
    ...(canManageStatusTypes  ? [{ to: '/ops/status-types',  label: 'Estados vehículo',  icon: Tag      }] : []),
  ];

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-muted/30">

      {/* ── Sidebar ── */}
      <aside className="bg-brand flex w-60 flex-shrink-0 flex-col">

        {/* Logo */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <BrandLogo size={36} />
          <div>
            <div className="text-sm font-bold leading-tight text-white">Vehicle Inspection</div>
            <div className="text-xs text-white/50">ConstruMarket</div>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-brand-accent text-brand-navy font-semibold shadow-sm'
                    : 'text-white/65 hover:bg-white/10 hover:text-white',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Usuario + logout */}
        <div className="border-t border-white/10 px-4 py-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user?.fullName}</p>
              <p className="text-xs text-white/50">
                {ROLE_LABELS[user?.role ?? ''] ?? user?.role}
              </p>
            </div>
            {canManageSettings && (
              <NavLink
                to="/ops/settings"
                title="Configuración"
                aria-label="Configuración"
                className={({ isActive }) =>
                  cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                    isActive
                      ? 'bg-brand-accent text-brand-navy'
                      : 'text-white/55 hover:bg-white/10 hover:text-white',
                  )
                }
              >
                <Settings2 className="h-4 w-4" />
              </NavLink>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── Contenido principal ── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <Routes>
          <Route index                    element={<OpsCenter />} />
          <Route path="issues"            element={<IssuesPage />} />
          <Route path="reports"           element={<ReportsPage />} />
          <Route path="fleet-monitor"     element={<FleetMonitorPage />} />
          <Route path="fleet"             element={<FleetPage />} />
          <Route path="drivers"           element={<DriversPage />} />
          <Route path="users"             element={<UsersPage />} />
          <Route path="status-types"      element={<VehicleStatusTypesPage />} />
          <Route path="settings"          element={<SettingsPage />} />
          {/* Fallback: cualquier sub-ruta desconocida va al centro */}
          <Route path="*"                 element={<OpsCenter />} />
        </Routes>
      </main>
    </div>
  );
}

// ─── Componente de cabecera de página reutilizable ────────────────────────────

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
  onBack?: () => void;
}

export function PageHeader({ title, subtitle, action, backTo, backLabel, onBack }: PageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = onBack ?? (backTo ? () => navigate(backTo) : undefined);

  return (
    <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
      <div className="flex items-center gap-3">
        {handleBack && (
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
            {backLabel ?? 'Volver'}
          </button>
        )}
        <div>
          <h1 className="text-xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
