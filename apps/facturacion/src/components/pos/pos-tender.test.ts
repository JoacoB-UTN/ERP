import { describe, expect, it } from 'vitest';
import { resolveCashTender, buildTenderInput } from './pos-tender';

describe('resolveCashTender', () => {
  it('treats an empty input as exact payment (received = total, change 0)', () => {
    const r = resolveCashTender(18500, '');
    expect(r.receivedNum).toBe(18500);
    expect(r.change).toBe(0);
    expect(r.insufficient).toBe(false);
  });

  it('computes change for a received amount above the total', () => {
    const r = resolveCashTender(18500, '20000');
    expect(r.receivedNum).toBe(20000);
    expect(r.change).toBe(1500);
    expect(r.insufficient).toBe(false);
  });

  it('flags an amount below the total as insufficient', () => {
    const r = resolveCashTender(18500, '10000');
    expect(r.insufficient).toBe(true);
    expect(r.change).toBe(-8500);
  });

  it('flags a non-numeric input as insufficient rather than crashing', () => {
    const r = resolveCashTender(18500, 'abc');
    expect(r.insufficient).toBe(true);
  });

  it('exact payment (received == total) is not insufficient', () => {
    const r = resolveCashTender(18500, '18500');
    expect(r.insufficient).toBe(false);
    expect(r.change).toBe(0);
  });
});

describe('buildTenderInput', () => {
  it('CASH carries amountReceived as a string', () => {
    expect(buildTenderInput('CASH', 20000)).toEqual({ method: 'CASH', amountReceived: '20000' });
  });

  it('CARD/TRANSFER/OTHER never carry amountReceived', () => {
    expect(buildTenderInput('CARD', 18500)).toEqual({ method: 'CARD' });
    expect(buildTenderInput('TRANSFER', 18500)).toEqual({ method: 'TRANSFER' });
    expect(buildTenderInput('OTHER', 18500)).toEqual({ method: 'OTHER' });
  });
});
