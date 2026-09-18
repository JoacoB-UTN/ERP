'use client';

import { useSystemDiagnostics } from '@/lib/auth-client';
import { describeDiagnostics, type DiagnosticsTone } from '@/lib/system-diagnostics';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * Diagnóstico del servidor — what an operator needs to answer "why is this
 * machine behaving like this?" without a remote session.
 *
 * Sits below Estado del sistema and answers a different question. That panel
 * asks "is it working right now" from the public `GET /health`; this one asks
 * "what is this machine" from `GET /system/diagnostics`, which is gated
 * behind `system.backups.read` precisely because a version, an uptime and a
 * disk size must not be readable by anyone who can reach the port.
 *
 * Read-only, like everything on this screen: nothing here restarts a service
 * or frees disk. A read permission must never gate an action.
 *
 * See docs/backups.md and docs/server-installer.md.
 */

const badgeTone: Record<DiagnosticsTone, 'success' | 'warning' | 'danger' | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'neutral',
};

export function SystemDiagnosticsPanel() {
  const query = useSystemDiagnostics();
  const rows = describeDiagnostics(query.data);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Diagnóstico del servidor</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Datos de la máquina donde corre el ERP Server. Solo lectura.
          </p>
        </div>

        {query.isPending && (
          <p className="text-sm text-muted-foreground">Midiendo…</p>
        )}

        {query.isError && (
          // An unreachable diagnostics endpoint is itself a diagnosis, so it
          // says so instead of rendering an empty grid.
          <p className="text-sm text-muted-foreground">
            No se pudo obtener el diagnóstico del servidor.
          </p>
        )}

        {!query.isPending && !query.isError && (
          <dl className="grid gap-3 sm:grid-cols-3">
            {rows.map((row) => (
              <div key={row.key} className="rounded-md border border-border bg-muted/40 p-3">
                <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                <dd className="mt-1.5">
                  <StatusBadge tone={badgeTone[row.tone]}>{row.value}</StatusBadge>
                  {row.hint && (
                    <p className="mt-1.5 text-xs text-muted-foreground">{row.hint}</p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
