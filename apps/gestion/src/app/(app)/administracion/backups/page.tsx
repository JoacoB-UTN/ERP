'use client';

import { AlertTriangle, CheckCircle2, CloudOff, HardDrive, ShieldAlert } from 'lucide-react';
import type { BackupRunRecord } from '@erp/shared';
import { usePermissions, useBackupStatus } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableMessage } from '@/components/ui/table-support';
import { Unauthorized } from '@/components/layout/unauthorized';

/**
 * Server backup health.
 *
 * Read-only on purpose — see docs/backups.md. A backup covers every company on
 * the server, so it is taken and restored by the maintenance agent and its CLI,
 * never from a company-scoped screen. What this page owes the owner of the
 * business is a truthful answer to one question: "if this PC dies tonight, what
 * do I lose?" Everything below is arranged around that answer.
 */

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** Whole hours since the last successful backup — the number that actually matters. */
function hoursSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000));
}

function formatAge(iso: string): string {
  const hours = hoursSince(iso);
  if (hours < 1) return 'hace menos de una hora';
  if (hours < 24) return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function CloudCell({ run }: { run: BackupRunRecord }) {
  switch (run.cloud.status) {
    case 'uploaded':
      return <StatusBadge tone="success">Subida</StatusBadge>;
    case 'failed':
      return <StatusBadge tone="warning">Falló</StatusBadge>;
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

export default function BackupsPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const statusQuery = useBackupStatus();

  if (permissionsLoading) return null;
  if (!can('system.backups.read')) return <Unauthorized />;

  const status = statusQuery.data;
  const lastSuccess = status?.lastSuccessfulRun ?? null;

  // Three states worth distinguishing, because they call for different actions:
  // no agent installed at all, an agent whose last run failed, and healthy.
  const notConfigured = !!status && !status.configured;
  const lastRunFailed = status?.lastRun?.status === 'failed';
  const staleBackup = !!lastSuccess && hoursSince(lastSuccess.startedAt) >= 48;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Backups del servidor"
        description="Estado de las copias de seguridad de la base de datos. Las copias se toman y se restauran desde el servidor, no desde esta pantalla."
      />

      {statusQuery.isLoading && (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Cargando el estado de los backups…
          </CardContent>
        </Card>
      )}

      {statusQuery.isError && (
        <Card>
          <CardContent className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">No se pudo obtener el estado de los backups.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Revisá que el servidor del ERP esté accesible e intentá de nuevo.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {notConfigured && (
        <Card>
          <CardContent className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">No hay backups configurados en este servidor.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                El servicio de mantenimiento del ERP no está instalado o todavía no ejecutó
                ninguna copia. Hasta que lo esté, los datos de la empresa no tienen ninguna
                copia de seguridad automática.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status?.configured && (
        <>
          {(lastRunFailed || staleBackup) && (
            <Card>
              <CardContent className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
                <div>
                  <p className="font-medium">
                    {lastRunFailed
                      ? 'El último backup falló.'
                      : 'La última copia correcta tiene más de 48 horas.'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {lastSuccess
                      ? `La copia utilizable más reciente es del ${formatDateTime(lastSuccess.startedAt)} (${formatAge(lastSuccess.startedAt)}).`
                      : 'No hay ninguna copia correcta registrada en este servidor.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4" />
                  Última copia correcta
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lastSuccess ? (
                  <>
                    <p className="text-base font-semibold">{formatAge(lastSuccess.startedAt)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(lastSuccess.startedAt)}
                    </p>
                  </>
                ) : (
                  <p className="text-base font-semibold text-destructive">Ninguna</p>
                )}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                  <HardDrive className="size-4" />
                  Copias guardadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base font-semibold">{status.storedBackups}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatSize(status.totalSizeBytes)} · se conservan {status.retentionDays} días
                </p>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Próxima copia</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base font-semibold">
                  {status.nextRunAt ? formatDateTime(status.nextRunAt) : '—'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Programada: {status.schedule.join(', ') || '—'}
                </p>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                  {status.cloudEnabled ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <CloudOff className="size-4" />
                  )}
                  Copia externa
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base font-semibold">
                  {status.cloudEnabled ? 'Activada' : 'Desactivada'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {status.cloudEnabled
                    ? 'Cada copia se sube fuera del servidor.'
                    : 'Las copias sólo existen en este servidor.'}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Historial</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Fecha</th>
                      <th className="px-4 py-2 font-medium">Estado</th>
                      <th className="px-4 py-2 font-medium">Verificada</th>
                      <th className="px-4 py-2 font-medium">Copia externa</th>
                      <th className="px-4 py-2 font-medium">Tamaño</th>
                      <th className="px-4 py-2 font-medium">Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.recentRuns.length === 0 && (
                      <TableMessage
                        columns={6}
                        title="Todavía no hay copias registradas."
                        description="La primera copia se tomará en el próximo horario programado."
                      />
                    )}
                    {status.recentRuns.map((run) => (
                      <tr key={run.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 whitespace-nowrap">
                          {formatDateTime(run.startedAt)}
                        </td>
                        <td className="px-4 py-2">
                          {run.status === 'success' ? (
                            <StatusBadge tone="success">Correcta</StatusBadge>
                          ) : (
                            <StatusBadge tone="danger">Falló</StatusBadge>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {/* A dump that pg_restore cannot read back is not a
                              backup — surfaced per run rather than hidden. */}
                          {run.verified ? (
                            <StatusBadge tone="success">Sí</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">No</StatusBadge>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <CloudCell run={run} />
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {run.sizeBytes ? formatSize(run.sizeBytes) : '—'}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {run.trigger === 'scheduled' ? 'Programada' : 'Manual'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Para restaurar una copia, ejecutá <code>erp-backup restore</code> en el servidor con
            el ERP detenido. La restauración no se puede hacer desde esta pantalla porque afecta
            a todas las empresas del servidor.
          </p>
        </>
      )}
    </div>
  );
}
