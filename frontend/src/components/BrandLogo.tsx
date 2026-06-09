import logoCm from '@/assets/logo-cm.png';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  /** Tamaño del contenedor cuadrado en píxeles. Por defecto 44. */
  size?: number;
  className?: string;
}

/**
 * Logo oficial de ConstruMarket.
 * Se muestra dentro de un contenedor blanco con esquinas redondeadas y
 * sombra sutil, de modo que se integre correctamente sobre fondos oscuros
 * (como la barra de navegación navy).
 */
export function BrandLogo({ size = 44, className }: BrandLogoProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-white/20 overflow-hidden',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={logoCm}
        alt="ConstruMarket"
        className="h-full w-full object-contain p-1"
        draggable={false}
      />
    </div>
  );
}
