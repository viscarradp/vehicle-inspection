import type { SettingSource } from '@/types';

interface BadgeConfig {
  dot:   string;
  badge: string;
  label: string;
}

const CONFIG: Record<SettingSource, BadgeConfig> = {
  default: { dot: 'bg-slate-400',  badge: 'bg-slate-100 text-slate-600',   label: 'Por defecto'   },
  global:  { dot: 'bg-orange-400', badge: 'bg-orange-100 text-orange-700', label: 'Global'        },
  country: { dot: 'bg-indigo-400', badge: 'bg-indigo-100 text-indigo-700', label: 'País'          },
  branch:  { dot: 'bg-violet-400', badge: 'bg-violet-100 text-violet-700', label: 'Esta sucursal' },
};

interface SourceBadgeProps {
  source: SettingSource;
}

export function SourceBadge({ source }: SourceBadgeProps) {
  const { dot, badge, label } = CONFIG[source];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
