import { describe, expect, it } from 'vitest';
import { planRetention } from '../src/retention';

const at = (stamp: string) => `erp-erp_platform-${stamp}.dump`;

describe('planRetention', () => {
  const now = new Date(2026, 8, 1, 12, 0, 0); // 2026-09-01 12:00 local

  it('keeps archives inside the retention window', () => {
    const files = [at('20260831-030000'), at('20260830-030000')];
    const plan = planRetention(files, 30, 7, now);

    expect(plan.deleteExpired).toEqual([]);
    expect(plan.keep).toHaveLength(2);
  });

  it('deletes archives older than the retention window', () => {
    const files = [
      at('20260831-030000'),
      at('20260101-030000'), // 8 months old
    ];
    const plan = planRetention(files, 30, 1, now);

    expect(plan.deleteExpired).toEqual([at('20260101-030000')]);
  });

  it('never prunes below the minimum, even when everything is expired', () => {
    // The agent was offline for a year: every archive is past retention.
    const files = [
      at('20250901-030000'),
      at('20250831-030000'),
      at('20250830-030000'),
      at('20250829-030000'),
    ];

    const plan = planRetention(files, 30, 3, now);

    // Three newest survive despite being expired; only the oldest goes.
    expect(plan.keep).toEqual([
      at('20250901-030000'),
      at('20250831-030000'),
      at('20250830-030000'),
    ]);
    expect(plan.deleteExpired).toEqual([at('20250829-030000')]);
  });

  it('never deletes the last remaining backup', () => {
    const plan = planRetention([at('20200101-030000')], 30, 7, now);

    expect(plan.deleteExpired).toEqual([]);
    expect(plan.keep).toHaveLength(1);
  });

  it('ignores files that are not ERP archives', () => {
    const files = ['notes.txt', 'manifest.json', at('20260831-030000')];
    const plan = planRetention(files, 30, 7, now);

    expect(plan.keep).toEqual([at('20260831-030000')]);
    expect(plan.deleteExpired).toEqual([]);
  });

  it('orders newest first regardless of input order', () => {
    const files = [at('20260101-030000'), at('20260831-030000'), at('20260601-030000')];
    const plan = planRetention(files, 3650, 7, now);

    expect(plan.keep).toEqual([
      at('20260831-030000'),
      at('20260601-030000'),
      at('20260101-030000'),
    ]);
  });
});
