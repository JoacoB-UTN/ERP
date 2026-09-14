import { describe, it, expect } from 'vitest';
import type { HealthProbe } from './api';
import { describeSystemStatus, formatCheckedAt } from './system-status';

/**
 * What this screen must never do is state something the health check did not
 * establish. Most of these tests are therefore negative: not "does it say the
 * right thing" but "does it refuse to say the wrong one".
 */

const reachable = (
  status: 'ok' | 'degraded' | 'error',
  database: 'ok' | 'error',
  redis: 'ok' | 'error',
): HealthProbe => ({ reachable: true, response: { status, services: { database, redis } } });

const unreachable: HealthProbe = { reachable: false, response: null };

const view = (probe: HealthProbe | undefined, isFirstCheck = false) =>
  describeSystemStatus({ isFirstCheck, probe });

const service = (v: ReturnType<typeof view>, key: 'api' | 'database' | 'redis') =>
  v.services.find((s) => s.key === key)!;

describe('describeSystemStatus', () => {
  it('reports everything operative when the API says so', () => {
    const v = view(reachable('ok', 'ok', 'ok'));
    expect(v.overallLabel).toBe('Sistema operativo');
    expect(v.overallTone).toBe('success');
    expect(service(v, 'api').value).toBe('Conectado');
    expect(service(v, 'database').value).toBe('Operativa');
    expect(service(v, 'redis').value).toBe('Operativo');
    expect(v.services.every((s) => s.tone === 'success')).toBe(true);
  });

  it('reports degraded — not down — when only Redis fails', () => {
    const v = view(reachable('degraded', 'ok', 'error'));
    expect(v.overallLabel).toBe('Servicio degradado');
    expect(v.overallTone).toBe('warning');
    expect(service(v, 'database').value).toBe('Operativa');
    expect(service(v, 'redis').value).toBe('No disponible');
    expect(service(v, 'redis').tone).toBe('warning');
    // The owner of the business needs to know this is survivable.
    expect(service(v, 'redis').hint).toMatch(/sigue funcionando/i);
    expect(service(v, 'redis').hint).toMatch(/no se pierden datos/i);
    // And must not be told the system is down.
    expect(v.overallLabel).not.toMatch(/sin conexión|caíd/i);
  });

  it('reports the database as down while acknowledging the API answered', () => {
    const v = view(reachable('error', 'error', 'ok'));
    expect(v.overallLabel).toBe('Base de datos no disponible');
    expect(v.overallTone).toBe('danger');
    expect(service(v, 'database').value).toBe('No disponible');
    expect(service(v, 'database').hint).toMatch(/no puede/i);
    // The server DID respond — this is not a connectivity failure.
    expect(service(v, 'api').value).toBe('Conectado');
    expect(service(v, 'api').tone).toBe('success');
    expect(v.overallLabel).not.toMatch(/sin conexión/i);
  });

  it('does not claim PostgreSQL or Redis are down when the API was unreachable', () => {
    const v = view(unreachable);
    expect(v.overallLabel).toBe('Sin conexión con el servidor');
    expect(v.overallTone).toBe('danger');
    expect(service(v, 'api').value).toBe('Sin respuesta');

    // The point of the whole change: unknown, not failed.
    for (const key of ['database', 'redis'] as const) {
      expect(service(v, key).value).toBe('No se pudo comprobar');
      expect(service(v, key).tone).toBe('neutral');
      expect(service(v, key).value).not.toMatch(/no disponible/i);
    }
    expect(v.overallDetail).toMatch(/tampoco se pudo comprobar/i);
  });

  it('reports both services down when the API actually says both are down', () => {
    // The mirror of the test above: a real answer of "everything is broken"
    // must still be reported as such, or the fix would have overcorrected.
    const v = view(reachable('error', 'error', 'error'));
    expect(service(v, 'database').value).toBe('No disponible');
    expect(service(v, 'redis').value).toBe('No disponible');
    expect(v.overallLabel).toBe('Base de datos no disponible');
  });

  it('does not tell the operator the system keeps working when the database is down too', () => {
    // The panel used to say "operations cannot continue" at the top and "the
    // system keeps working without the cache" on the Redis card, in the same
    // breath. The Redis reassurance is only true while PostgreSQL is up.
    const v = view(reachable('error', 'error', 'error'));
    expect(service(v, 'redis').hint).toBeUndefined();

    const everything = [
      v.overallLabel,
      v.overallDetail,
      ...v.services.flatMap((s) => [s.value, s.hint ?? '']),
    ].join(' ');
    expect(everything).not.toMatch(/sigue funcionando/i);
    expect(everything).not.toMatch(/no se pierden datos/i);
    // And the overall verdict still leads with the database, not the cache.
    expect(v.overallLabel).toBe('Base de datos no disponible');
  });

  it('keeps the reassurance when only Redis is down', () => {
    // The complement: removing the hint unconditionally would have been just
    // as wrong, because this is the case it exists for.
    const v = view(reachable('degraded', 'ok', 'error'));
    expect(service(v, 'redis').hint).toMatch(/sigue funcionando/i);
    expect(service(v, 'redis').hint).toMatch(/no se pierden datos/i);
  });

  it('says it is still checking before the first result', () => {
    const v = view(undefined, true);
    expect(v.overallLabel).toBe('Comprobando el estado…');
    expect(v.overallTone).toBe('neutral');
    expect(v.services.every((s) => s.value === 'Comprobando…')).toBe(true);
    // Never a verdict before there is one.
    expect(v.overallLabel).not.toMatch(/sin conexión|operativo|degradado/i);
  });

  it('keeps the last real result during a background refetch', () => {
    // isFirstCheck stays false while a refetch is in flight, so the previous
    // probe must keep being described rather than reverting to "comprobando".
    const v = view(reachable('ok', 'ok', 'ok'), false);
    expect(v.overallLabel).toBe('Sistema operativo');
  });

  it('every state carries words, never colour alone', () => {
    const probes = [reachable('ok', 'ok', 'ok'), reachable('degraded', 'ok', 'error'), reachable('error', 'error', 'ok'), unreachable];
    for (const probe of probes) {
      const v = view(probe);
      expect(v.overallLabel.length).toBeGreaterThan(0);
      expect(v.overallDetail.length).toBeGreaterThan(0);
      for (const s of v.services) expect(s.value.length).toBeGreaterThan(0);
    }
  });
});

describe('formatCheckedAt', () => {
  it('is null before any check has completed', () => {
    expect(formatCheckedAt(0)).toBeNull();
  });

  it('says "hoy" for a check made today', () => {
    const now = new Date('2026-09-14T18:30:00');
    expect(formatCheckedAt(new Date('2026-09-14T14:32:00').getTime(), now)).toMatch(/^hoy a las /);
  });

  it('gives the date for an older check', () => {
    const now = new Date('2026-09-14T18:30:00');
    const out = formatCheckedAt(new Date('2026-09-12T09:05:00').getTime(), now);
    expect(out).not.toMatch(/hoy/);
    expect(out).toMatch(/sep/i);
  });
});
