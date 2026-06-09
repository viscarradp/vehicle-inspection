import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Delete, Hand, Monitor } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';

import { useAuth }     from '@/context/AuthContext';
import { Input }       from '@/components/ui/input';
import { cn }          from '@/lib/utils';
import { getApiError } from '@/lib/apiError';
import { guessClientShift, shiftLabel, SHIFT_HOURS_HINT } from '@/lib/shifts';

const KEYPAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'] as const;

type Mode = 'touch' | 'desktop';

export function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();

  const [mode,     setMode]     = useState<Mode>('touch');
  const [username, setUsername] = useState('');
  const [pin,      setPin]      = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);
  const estimatedShift = guessClientShift();

  const canLoginTouch   = pin.length === 4 && username.trim().length > 0 && !loading;
  const canLoginDesktop = password.length > 0 && username.trim().length > 0 && !loading;

  useEffect(() => {
    if (mode === 'desktop') passwordRef.current?.focus();
  }, [mode]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setPin('');
    setPassword('');
  };

  const pressKey = (k: string) => {
    setError('');
    if (k === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length < 4) setPin(p => p + k);
  };

  const handleLogin = async () => {
    const credential = mode === 'touch' ? pin : password;
    const ok = mode === 'touch' ? canLoginTouch : canLoginDesktop;
    if (!ok) return;
    setLoading(true);
    setError('');
    try {
      const user = await login(username.trim().toLowerCase(), credential);
      navigate(user.role === 'guardia' ? '/guard' : '/ops');
    } catch (err: unknown) {
      const body = getApiError(err);
      if (body?.statusCode === 'USER_MISCONFIGURED') {
        setError(body.message || 'Tu usuario no tiene sucursal asignada. Contacta al administrador.');
      } else if (body?.statusCode === 'INVALID_CREDENTIALS') {
        setError('Usuario o PIN incorrecto.');
      } else {
        setError(body?.message ?? 'Error de servidor. Reintenta.');
      }
      setPin('');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toLocaleDateString('es-GT', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-100">

      {/* ── Barra superior ── */}
      <header className="bg-brand flex shrink-0 items-center justify-between border-b-[3px] border-b-brand-accent px-6 py-5 md:px-8">
        <div className="flex items-center gap-3">
          <BrandLogo size={44} />
          <div>
            <h1 className="text-xl font-bold leading-tight text-white md:text-2xl">Revisión de flota</h1>
            <p className="text-sm text-white/55">Control de recepción · ConstruMarket</p>
          </div>
        </div>
        <time className="font-mono text-sm text-white/55">{today}</time>
      </header>

      {/* ── Contenido centrado ── */}
      <main className="flex flex-1 items-center justify-center p-4 md:p-8">
        <div className="flex w-full max-w-sm flex-col items-center gap-3">

          {/* Control segmentado */}
          <div className="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/[0.06]">
            {([
              { id: 'touch',   label: 'Táctil',    Icon: Hand    },
              { id: 'desktop', label: 'Escritorio', Icon: Monitor },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => switchMode(id)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-all duration-200',
                  mode === id
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Tarjeta principal */}
          <div className="w-full rounded-2xl bg-white px-6 py-7 shadow-lg ring-1 ring-black/[0.06]">

            {/* Título */}
            <h2 className="mb-5 text-center text-2xl font-bold tracking-tight text-slate-900">
              Ingresa tu PIN
            </h2>

            {/* Cuadro de turno */}
            <div className="mb-5 rounded-xl bg-slate-50 px-4 py-3 text-center ring-1 ring-slate-200">
              <p className="text-sm font-semibold text-slate-700">
                {shiftLabel(estimatedShift)} · {SHIFT_HOURS_HINT[estimatedShift]}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                El servidor asigna el turno al registrar cada vehículo
              </p>
            </div>

            {/* Campo usuario */}
            <div className="mb-4">
              <label
                htmlFor="username"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400"
              >
                Usuario
              </label>
              <Input
                id="username"
                placeholder="admin"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(''); }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-12 text-base"
              />
            </div>

            {/* ── Vista TÁCTIL ── */}
            <div
              className={cn(
                'transition-all duration-300 ease-in-out',
                mode === 'touch'
                  ? 'max-h-[500px] opacity-100'
                  : 'max-h-0 overflow-hidden opacity-0 pointer-events-none',
              )}
            >
              {/* Indicador PIN */}
              <div className="mb-5 flex justify-center gap-4 pt-1">
                {[0,1,2,3].map(i => (
                  <span
                    key={i}
                    className={cn(
                      'h-3.5 w-3.5 rounded-full border-2 transition-all duration-150',
                      pin.length > i
                        ? 'scale-110 border-brand bg-brand'
                        : 'border-slate-300 bg-transparent',
                    )}
                    aria-hidden
                  />
                ))}
              </div>

              {/* Teclado PIN */}
              <div className="grid grid-cols-3 gap-2">
                {KEYPAD.map((k, i) =>
                  k === '' ? (
                    <span key={i} aria-hidden />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pressKey(k)}
                      className={cn(
                        'flex h-14 items-center justify-center rounded-xl',
                        'bg-slate-50 text-slate-800 text-xl font-semibold',
                        'transition-all duration-100 hover:bg-slate-100',
                        'active:scale-95 active:bg-slate-200',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                      )}
                    >
                      {k === '⌫'
                        ? <Delete className="h-5 w-5 text-slate-400" />
                        : k}
                    </button>
                  ),
                )}
              </div>
            </div>

            {/* ── Vista ESCRITORIO ── */}
            <div
              className={cn(
                'transition-all duration-300 ease-in-out',
                mode === 'desktop'
                  ? 'max-h-[200px] opacity-100'
                  : 'max-h-0 overflow-hidden opacity-0 pointer-events-none',
              )}
            >
              <label
                htmlFor="password"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400"
              >
                Contraseña / PIN
              </label>
              <Input
                ref={passwordRef}
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
                className="h-12 text-base"
              />
            </div>

            {/* Error sutil */}
            {error && (
              <p className="mt-3 text-center text-sm text-red-500">{error}</p>
            )}

            {/* Botón ingresar */}
            <button
              onClick={handleLogin}
              disabled={mode === 'touch' ? !canLoginTouch : !canLoginDesktop}
              className={cn(
                'mt-5 flex w-full items-center justify-center rounded-xl py-3.5',
                'bg-brand text-base font-semibold text-white',
                'transition-all hover:opacity-90 active:scale-[0.99]',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              {loading
                ? <Loader2 className="h-5 w-5 animate-spin" />
                : 'Ingresar'}
            </button>

          </div>
        </div>
      </main>
    </div>
  );
}
