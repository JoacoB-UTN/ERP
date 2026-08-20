'use client';

import { useActiveCompany } from '@/lib/auth-client';
import { useServerHealth } from '@/lib/use-server-health';
import { cn } from '@/lib/utils';

const STATUS_COPY: Record<'connected' | 'degraded' | 'disconnected', string> = {
  connected: 'Conectado',
  degraded: 'Degradado',
  disconnected: 'Sin conexión',
};

const STATUS_DOT: Record<'connected' | 'degraded' | 'disconnected', string> = {
  connected: 'bg-success',
  degraded: 'bg-warning',
  disconnected: 'bg-destructive',
};

/**
 * Slim, low-emphasis status strip — the desktop-chrome concept from
 * docs/desktop-ui-direction.md's "Status bar" section. Real connection
 * state, not fabricated: backed by GET /health via useServerHealth, the
 * one existing endpoint safe to poll without any backend change (see
 * docs/desktop-lan-architecture.md's "Failure behavior"). There is no
 * branch context here because Gestión has no branch-scoped session today
 * (see docs/sales.md) — this bar only ever shows signals that actually
 * exist, never a placeholder for one that doesn't.
 */
export function StatusBar({ userEmail }: { userEmail: string }) {
  const { activeCompany } = useActiveCompany();
  const { status } = useServerHealth();

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/40 px-4 text-[0.6875rem] text-muted-foreground md:px-6">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])} aria-hidden="true" />
        <span>{STATUS_COPY[status]}</span>
        {activeCompany && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{activeCompany.tradeName ?? activeCompany.legalName}</span>
          </>
        )}
      </div>
      <span className="truncate">{userEmail}</span>
    </footer>
  );
}
