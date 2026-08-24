import { GESTION_URL } from '@/lib/workspace-urls';
import { cn } from '@/lib/utils';

/**
 * Mirrors Gestión's own WorkspaceSwitcher (apps/gestion/src/components/layout/workspace-switcher.tsx)
 * so both shells read as two workspaces of one ERP — see
 * docs/desktop-ui-direction.md's "Navigation" and the final report's
 * "Workspace switching concept". Deliberately not extracted into a shared
 * package yet — two ~15-line copies is not worth a new shared-UI surface
 * for a limited prototype (see product-ui-principles.md's "no premature
 * abstraction").
 */
export function WorkspaceSwitcher() {
  return (
    <div
      role="group"
      aria-label="Cambiar de espacio de trabajo"
      className="flex h-7 shrink-0 items-center rounded-md border border-border bg-muted/40 p-0.5 text-xs font-medium"
    >
      <a
        href={GESTION_URL}
        className={cn(
          'flex h-full items-center rounded-[5px] px-2.5 text-muted-foreground transition-colors hover:text-foreground',
        )}
      >
        Gestión
      </a>
      <span aria-current="page" className="flex h-full items-center rounded-[5px] bg-card px-2.5 text-foreground shadow-sm">
        Facturación
      </span>
    </div>
  );
}
