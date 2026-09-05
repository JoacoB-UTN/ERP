import { describe, expect, it } from 'vitest';
import { nextRunAt } from '../src/schedule';

describe('nextRunAt', () => {
  it('returns today when the time has not passed yet', () => {
    const now = new Date(2026, 8, 1, 1, 0, 0);
    const next = nextRunAt(['03:00'], now);

    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(3);
    expect(next.getMinutes()).toBe(0);
  });

  it('rolls over to tomorrow once the time has passed', () => {
    const now = new Date(2026, 8, 1, 4, 0, 0);
    const next = nextRunAt(['03:00'], now);

    expect(next.getDate()).toBe(2);
    expect(next.getHours()).toBe(3);
  });

  it('picks the soonest of several configured times', () => {
    const now = new Date(2026, 8, 1, 4, 0, 0);
    const next = nextRunAt(['03:00', '15:00', '22:00'], now);

    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(15);
  });

  it('is strictly in the future when now is exactly the scheduled time', () => {
    // Guards against a busy-loop firing the same run repeatedly at 03:00:00.
    const now = new Date(2026, 8, 1, 3, 0, 0, 0);
    const next = nextRunAt(['03:00'], now);

    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getDate()).toBe(2);
  });

  it('crosses a month boundary correctly', () => {
    const now = new Date(2026, 8, 30, 23, 0, 0);
    const next = nextRunAt(['03:00'], now);

    expect(next.getMonth()).toBe(9); // October
    expect(next.getDate()).toBe(1);
  });
});
