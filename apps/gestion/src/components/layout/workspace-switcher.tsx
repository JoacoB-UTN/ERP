import { FACTURACION_URL } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Concrete UX for "switching between Gestión and Facturación" (see
 * docs/desktop-ui-direction.md's "Navigation" and the final report's
 * "Workspace switching concept"): a compact, always-visible two-item
 * control in the top bar, current workspace unmistakable, functional
 * navigation to the other workspace's real origin — not a placeholder.
 * POS stays reachable only through Facturación, matching AGENTS.md
 * ("POS is a mode of Facturación, not a third app") — this switcher
 * deliberately has exactly two entries, never three.
 */
export function WorkspaceSwitcher() {
  return (
    <div
      role="group"
      aria-label="Cambiar de espacio de trabajo"
      className="flex h-7 shrink-0 items-center rounded-md border border-border bg-muted/40 p-0.5 text-xs font-medium"
    >
      <span aria-current="page" className="flex h-full items-center rounded-[5px] bg-card px-2.5 text-foreground shadow-sm">
        Gestión
      </span>
      <a
        href={FACTURACION_URL}
        className={cn(
          'flex h-full items-center rounded-[5px] px-2.5 text-muted-foreground transition-colors hover:text-foreground',
        )}
      >
        Facturación
      </a>
    </div>
  );
}
