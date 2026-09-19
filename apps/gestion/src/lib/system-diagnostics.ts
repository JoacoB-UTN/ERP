import type { SystemDiagnosticsResponse } from '@erp/shared';

/**
 * Turns the diagnostics payload into the rows the Servidor y backups screen
 * shows. Pure and separate from the component for the same reason
 * `system-status.ts` is: the property worth testing is that the screen never
 * says something the measurement did not establish.
 *
 * Two rules run through every formatter here:
 *
 * - `null` means "could not be measured" and is rendered as such, never as a
 *   zero. "0 GB libres" and "no lo pudimos medir" send an operator to two
 *   very different places.
 * - A tone is never the only signal. Every row carries a word, because a
 *   panel that communicates by colour alone fails the person reading it on a
 *   washed-out screen in a shop.
 */

export type DiagnosticsTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface DiagnosticsRow {
  key: 'version' | 'apiUptime' | 'databaseUptime' | 'latency' | 'disk' | 'databaseSize';
  label: string;
  value: string;
  tone: DiagnosticsTone;
  hint?: string;
}

const UNKNOWN = 'No se pudo medir';

/** Below this, a disk is close enough to full that backups start failing. */
const DISK_WARNING_RATIO = 0.15;
const DISK_DANGER_RATIO = 0.05;

/** Past this, a query that should be instant is not. */
const LATENCY_WARNING_MS = 250;
const LATENCY_DANGER_MS = 1000;

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10 so "1,4 GB" does not round to "1 GB", none above it
  // where the extra digit is noise.
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits).replace('.', ',')} ${units[unit]}`;
}

/**
 * The comparison that gives this panel its reason to exist.
 *
 * A PostgreSQL that has been up far longer than the API around it is the
 * visible signature of defect 12 on the Windows VM: WinSW's log rotation
 * killed the wrapper, Windows reported the service stopped, and the
 * postmaster kept serving unsupervised. Nothing in the Windows service list
 * shows that; this row does.
 *
 * The threshold is deliberately generous. Restarting only the API is a
 * perfectly normal thing to do, so this must not cry wolf — it flags the case
 * where the database predates the API by more than a day, which is what an
 * orphan that survived a service restart actually looks like.
 */
const ORPHAN_SUSPICION_SECONDS = 86_400;

export function describeDiagnostics(
  data: SystemDiagnosticsResponse | undefined,
): DiagnosticsRow[] {
  if (!data) return [];

  const rows: DiagnosticsRow[] = [
    {
      key: 'version',
      label: 'Versión instalada',
      value: data.server.version === 'unknown' ? UNKNOWN : data.server.version,
      tone: data.server.version === 'unknown' ? 'warning' : 'neutral',
      hint: `Node ${data.server.nodeVersion}`,
    },
    {
      key: 'apiUptime',
      label: 'API en línea desde hace',
      value: formatDuration(data.server.uptimeSeconds),
      // A very young API is not an error, but it is worth noticing: a service
      // that keeps restarting shows a few seconds here on every refresh.
      tone: data.server.uptimeSeconds < 60 ? 'warning' : 'success',
      hint:
        data.server.uptimeSeconds < 60
          ? 'Arrancó recién. Si este número se reinicia solo, el servicio se está cayendo.'
          : undefined,
    },
    describeDatabaseUptime(data),
    describeLatency(data.database.latencyMs),
    describeDisk(data.disk.backups),
    {
      key: 'databaseSize',
      label: 'Tamaño de la base',
      value:
        data.database.sizeBytes === null
          ? UNKNOWN
          : formatBytes(data.database.sizeBytes),
      tone: data.database.sizeBytes === null ? 'warning' : 'neutral',
    },
  ];

  return rows;
}

function describeDatabaseUptime(
  data: SystemDiagnosticsResponse,
): DiagnosticsRow {
  const dbUptime = data.database.uptimeSeconds;
  if (dbUptime === null) {
    return {
      key: 'databaseUptime',
      label: 'PostgreSQL en línea desde hace',
      value: UNKNOWN,
      tone: 'warning',
    };
  }

  const outlivesApiBy = dbUptime - data.server.uptimeSeconds;
  const suspectedOrphan = outlivesApiBy > ORPHAN_SUSPICION_SECONDS;

  return {
    key: 'databaseUptime',
    label: 'PostgreSQL en línea desde hace',
    value: formatDuration(dbUptime),
    tone: suspectedOrphan ? 'warning' : 'success',
    hint: suspectedOrphan
      ? 'Lleva mucho más tiempo en línea que el resto del servidor. Revisá que el servicio erp-postgres lo esté supervisando y no haya quedado un proceso suelto.'
      : undefined,
  };
}

function describeLatency(latencyMs: number | null): DiagnosticsRow {
  if (latencyMs === null) {
    return {
      key: 'latency',
      label: 'Respuesta de la base',
      value: UNKNOWN,
      tone: 'warning',
    };
  }

  const tone: DiagnosticsTone =
    latencyMs >= LATENCY_DANGER_MS
      ? 'danger'
      : latencyMs >= LATENCY_WARNING_MS
        ? 'warning'
        : 'success';

  return {
    key: 'latency',
    label: 'Respuesta de la base',
    value: `${latencyMs.toFixed(latencyMs < 10 ? 1 : 0).replace('.', ',')} ms`,
    tone,
    hint:
      tone === 'success'
        ? undefined
        : 'Una consulta trivial está tardando de más. Puede ser disco lento o la máquina exigida.',
  };
}

function describeDisk(
  disk: SystemDiagnosticsResponse['disk']['backups'],
): DiagnosticsRow {
  if (!disk || disk.totalBytes === 0) {
    return {
      key: 'disk',
      label: 'Espacio libre en disco',
      value: UNKNOWN,
      tone: 'warning',
    };
  }

  const ratio = disk.freeBytes / disk.totalBytes;
  const tone: DiagnosticsTone =
    ratio <= DISK_DANGER_RATIO
      ? 'danger'
      : ratio <= DISK_WARNING_RATIO
        ? 'warning'
        : 'success';

  return {
    key: 'disk',
    label: 'Espacio libre en disco',
    value: `${formatBytes(disk.freeBytes)} de ${formatBytes(disk.totalBytes)}`,
    tone,
    hint:
      tone === 'success'
        ? undefined
        : 'Queda poco espacio. Si el disco se llena, los backups dejan de guardarse y PostgreSQL deja de aceptar escrituras.',
  };
}
