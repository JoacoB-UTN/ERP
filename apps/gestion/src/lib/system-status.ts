import type { CurrentAccountsBackfillState } from '@erp/shared';
import type { HealthProbe } from './api';

/**
 * Turns one health probe into the words and tones the Estado del sistema
 * panel shows. Pure, and deliberately separate from the component: what this
 * screen must never do is say something the probe did not actually establish,
 * and that is a property of this mapping, testable on its own.
 *
 * It reports only what `GET /health` returns — reachability, PostgreSQL,
 * Redis, and the Current Accounts backfill state. No uptime, version, disk,
 * memory or latency: the endpoint does not measure them, so the panel does
 * not show them.
 *
 * The backfill row is a STATE and nothing else — no counts, no company
 * names, no amounts. An operator needs to know whether current accounts can
 * be trusted right now; they do not need, and this screen must not leak,
 * anything about what is in them.
 */

export type SystemStatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface SystemStatusService {
  key: 'api' | 'database' | 'redis' | 'currentAccountsBackfill';
  label: string;
  /** Always a word, never only a colour — the tone is an addition to this, not a substitute. */
  value: string;
  tone: SystemStatusTone;
  hint?: string;
}

export interface SystemStatusView {
  overallLabel: string;
  overallTone: SystemStatusTone;
  overallDetail: string;
  services: SystemStatusService[];
}

const UNKNOWN = 'No se pudo comprobar';

const BACKFILL_LABEL = 'Cuentas corrientes (histórico)';

/**
 * One row per backfill state. `disabled` is deliberately NOT worded as if
 * everything were fine: turning the automatic load off hands the job to an
 * operator, it does not do the job.
 */
function describeBackfill(
  state: CurrentAccountsBackfillState,
): SystemStatusService {
  switch (state) {
    case 'complete':
      return {
        key: 'currentAccountsBackfill',
        label: BACKFILL_LABEL,
        value: 'Al día',
        tone: 'success',
      };
    case 'running':
      return {
        key: 'currentAccountsBackfill',
        label: BACKFILL_LABEL,
        value: 'Ejecutando…',
        tone: 'neutral',
        hint: 'Se están cargando los movimientos históricos. Las pantallas de cuentas corrientes no responden hasta que termine.',
      };
    case 'failed':
      return {
        key: 'currentAccountsBackfill',
        label: BACKFILL_LABEL,
        value: 'Falló',
        tone: 'danger',
        hint: 'No se pudieron cargar los movimientos históricos. Las cuentas corrientes no están disponibles; avisá a soporte.',
      };
    case 'disabled':
      return {
        key: 'currentAccountsBackfill',
        label: BACKFILL_LABEL,
        value: 'Desactivado',
        tone: 'warning',
        hint: 'La carga automática está apagada por configuración. Hasta que se ejecute a mano, las cuentas corrientes no están disponibles.',
      };
    case 'pending':
    default:
      return {
        key: 'currentAccountsBackfill',
        label: BACKFILL_LABEL,
        value: 'Pendiente',
        tone: 'warning',
        hint: 'Todavía no se terminó de cargar el histórico. Las cuentas corrientes no responden hasta entonces.',
      };
  }
}

export function describeSystemStatus(input: {
  /** True only before the first probe resolves. A background refetch is NOT this. */
  isFirstCheck: boolean;
  probe: HealthProbe | undefined;
}): SystemStatusView {
  const { isFirstCheck, probe } = input;

  // Nothing has been established yet. Everything reads "comprobando", which
  // is the honest answer — and the reason a background refetch must not land
  // here: it would throw away a real result for a spinner.
  if (isFirstCheck || !probe) {
    return {
      overallLabel: 'Comprobando el estado…',
      overallTone: 'neutral',
      overallDetail: 'Todavía no se completó la primera comprobación.',
      services: [
        { key: 'api', label: 'Servidor del ERP', value: 'Comprobando…', tone: 'neutral' },
        { key: 'database', label: 'Base de datos', value: 'Comprobando…', tone: 'neutral' },
        { key: 'redis', label: 'Caché (Redis)', value: 'Comprobando…', tone: 'neutral' },
        {
          key: 'currentAccountsBackfill',
          label: BACKFILL_LABEL,
          value: 'Comprobando…',
          tone: 'neutral',
        },
      ],
    };
  }

  // The request never arrived. We know the server did not answer and NOTHING
  // about PostgreSQL or Redis — claiming they are down would be inventing a
  // diagnosis we never made.
  if (!probe.reachable) {
    return {
      overallLabel: 'Sin conexión con el servidor',
      overallTone: 'danger',
      overallDetail:
        'No se pudo contactar al servidor del ERP. Al no haber respuesta, tampoco se pudo comprobar el estado de la base de datos ni del caché.',
      services: [
        {
          key: 'api',
          label: 'Servidor del ERP',
          value: 'Sin respuesta',
          tone: 'danger',
          hint: 'Revisá que el servidor esté encendido y conectado a la red.',
        },
        { key: 'database', label: 'Base de datos', value: UNKNOWN, tone: 'neutral' },
        { key: 'redis', label: 'Caché (Redis)', value: UNKNOWN, tone: 'neutral' },
        {
          key: 'currentAccountsBackfill',
          label: BACKFILL_LABEL,
          value: UNKNOWN,
          tone: 'neutral',
        },
      ],
    };
  }

  const { services } = probe.response;
  const backfill = describeBackfill(probe.response.currentAccountsBackfill);
  const databaseDown = services.database === 'error';
  const redisDown = services.redis === 'error';

  const api: SystemStatusService = {
    key: 'api',
    label: 'Servidor del ERP',
    value: 'Conectado',
    tone: 'success',
  };

  const database: SystemStatusService = databaseDown
    ? {
        key: 'database',
        label: 'Base de datos',
        value: 'No disponible',
        tone: 'danger',
        hint: 'El ERP no puede registrar ni consultar operaciones hasta que vuelva.',
      }
    : { key: 'database', label: 'Base de datos', value: 'Operativa', tone: 'success' };

  const redis: SystemStatusService = redisDown
    ? {
        key: 'redis',
        label: 'Caché (Redis)',
        value: 'No disponible',
        tone: 'warning',
        // "The system keeps working" is only true while the database is up.
        // With PostgreSQL down as well, the overall verdict already says
        // operations cannot continue, and repeating the opposite on this card
        // would have the panel contradict itself in the worst moment to be
        // confusing. Then the card states the fact and nothing more.
        hint: databaseDown
          ? undefined
          : 'El sistema sigue funcionando sin el caché. No se pierden datos.',
      }
    : { key: 'redis', label: 'Caché (Redis)', value: 'Operativo', tone: 'success' };

  // The server answered, so this is a diagnosis and not a guess. Database
  // first: it is the one that stops the business.
  if (databaseDown) {
    return {
      overallLabel: 'Base de datos no disponible',
      overallTone: 'danger',
      overallDetail:
        'El servidor responde, pero su base de datos no. Las operaciones del ERP no pueden continuar hasta que se restablezca.',
      services: [api, database, redis, backfill],
    };
  }

  if (redisDown || probe.response.status === 'degraded') {
    return {
      overallLabel: 'Servicio degradado',
      overallTone: 'warning',
      overallDetail:
        'El sistema puede seguir operando con normalidad. Un servicio auxiliar no está disponible y eso no implica pérdida de datos.',
      services: [api, database, redis, backfill],
    };
  }

  // The infrastructure is fine, but a module that cannot answer is not
  // "todo operativo". Saying so here is the difference between a panel an
  // operator can act on and one that contradicts the screen they just hit.
  if (probe.response.currentAccountsBackfill !== 'complete') {
    return {
      overallLabel: 'Cuentas corrientes no disponibles',
      overallTone: 'warning',
      overallDetail:
        'El servidor y la base de datos responden con normalidad, pero todavía no se cargó el histórico de cuentas corrientes. Esas pantallas no responden hasta que termine.',
      services: [api, database, redis, backfill],
    };
  }

  return {
    overallLabel: 'Sistema operativo',
    overallTone: 'success',
    overallDetail: 'El servidor y la base de datos responden con normalidad.',
    services: [api, database, redis, backfill],
  };
}

/** "hoy a las 14:32" / "12 sept, 09:05" — `null` before any check completed. */
export function formatCheckedAt(epochMs: number, now: Date = new Date()): string | null {
  if (!epochMs) return null;
  const at = new Date(epochMs);
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `hoy a las ${time}`;
  return `${at.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}, ${time}`;
}
