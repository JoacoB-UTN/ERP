'use client';

import { RefreshCw } from 'lucide-react';
import { useServerHealth } from '@/lib/use-server-health';
import { describeSystemStatus, formatCheckedAt, type SystemStatusTone } from '@/lib/system-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * Estado del sistema — the first thing on Servidor y backups.
 *
 * Read-only by design, like the rest of the screen: it answers "is the system
 * working right now", and offers no way to restart anything, run a command or
 * restore a backup. It shows only what `GET /health` actually reports, and
 * rides the existing `useServerHealth` query — the same one behind the
 * connection dot in the top bar — so there is no second health check and no
 * second polling interval anywhere in the app.
 *
 * See docs/backups.md and docs/desktop-lan-architecture.md.
 */

/** Tones map to the shared StatusBadge palette; every one of them also carries a word. */
const badgeTone: Record<SystemStatusTone, 'success' | 'warning' | 'danger' | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'neutral',
};

const dotClass: Record<SystemStatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground',
};

export function SystemStatusPanel() {
  const { probe, isFirstCheck, isChecking, lastCheckedAt, refresh } = useServerHealth();
  const view = describeSystemStatus({ isFirstCheck, probe });
  const checkedAt = formatCheckedAt(lastCheckedAt);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {/* Decorative: the label beside it is the real signal, so this
                  is hidden from screen readers rather than described twice. */}
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full ${dotClass[view.overallTone]}`}
              />
              <h2 className="text-base font-semibold">{view.overallLabel}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{view.overallDetail}</p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {isChecking && !isFirstCheck
                ? 'Actualizando…'
                : checkedAt
                  ? `Última comprobación: ${checkedAt}`
                  : 'Sin comprobaciones todavía'}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isChecking}
            >
              <RefreshCw data-icon="inline-start" className={isChecking ? 'animate-spin' : ''} />
              {/* "Actualizando…", never "Comprobando…": the latter is what the
                  panel says when nothing is known yet, and a background
                  refetch must not read as having lost the last real result. */}
              {isChecking ? 'Actualizando…' : 'Actualizar ahora'}
            </Button>
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          {view.services.map((service) => (
            <div key={service.key} className="rounded-md border border-border bg-muted/40 p-3">
              <dt className="text-xs font-medium text-muted-foreground">{service.label}</dt>
              <dd className="mt-1.5">
                <StatusBadge tone={badgeTone[service.tone]}>{service.value}</StatusBadge>
                {service.hint && (
                  <p className="mt-1.5 text-xs text-muted-foreground">{service.hint}</p>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
