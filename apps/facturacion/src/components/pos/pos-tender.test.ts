import { describe, expect, it } from 'vitest';
import { resolveCashTender, buildTenderInput } from './pos-tender';

describe('resolveCashTender', () => {
  it('treats an empty input as exact payment (received = total, change 0)', () => {
    const r = resolveCashTender('18500', '');
    expect(r.received).toBe('18500');
    expect(r.change).toBe('0');
    expect(r.insufficient).toBe(false);
  });

  it('computes change for a received amount above the total', () => {
    const r = resolveCashTender('18500', '20000');
    expect(r.received).toBe('20000');
    expect(r.change).toBe('1500');
    expect(r.insufficient).toBe(false);
  });

  it('flags an amount below the total as insufficient', () => {
    const r = resolveCashTender('18500', '10000');
    expect(r.insufficient).toBe(true);
    expect(r.change).toBe('-8500');
  });

  it('flags a non-numeric input as insufficient rather than crashing', () => {
    const r = resolveCashTender('18500', 'abc');
    expect(r.insufficient).toBe(true);
  });

  it('exact payment (received == total) is not insufficient', () => {
    const r = resolveCashTender('18500', '18500');
    expect(r.insufficient).toBe(false);
    expect(r.change).toBe('0');
  });

  // Decimal-cent regression coverage — these values are specifically
  // chosen because JS `number` arithmetic (0.3 - 0.1, etc.) produces
  // binary floating-point artifacts (e.g. 0.19999999999999998) instead
  // of the exact decimal result. See AGENTS.md's "never floating point
  // for money" rule and docs/pos.md.
  it('total 0.10 / received 0.30 -> change exactly 0.20 (classic float trap)', () => {
    const r = resolveCashTender('0.10', '0.30');
    expect(r.change).toBe('0.20');
    expect(r.insufficient).toBe(false);
  });

  it('total 10.10 / received 20.20 -> change exactly 10.10', () => {
    const r = resolveCashTender('10.10', '20.20');
    expect(r.change).toBe('10.10');
    expect(r.insufficient).toBe(false);
  });

  it('total 18500.25 / received 20000.50 -> change exactly 1500.25', () => {
    const r = resolveCashTender('18500.25', '20000.50');
    expect(r.change).toBe('1500.25');
    expect(r.insufficient).toBe(false);
  });

  it('exact-payment default preserves the total\'s own decimal precision', () => {
    const r = resolveCashTender('18500.25', '');
    expect(r.received).toBe('18500.25');
    expect(r.change).toBe('0.00');
  });
});

describe('buildTenderInput', () => {
  it('CASH carries amountReceived as the original decimal string, never Number()-converted', () => {
    expect(buildTenderInput('CASH', '20000')).toEqual({ method: 'CASH', amountReceived: '20000' });
    expect(buildTenderInput('CASH', '1500.25')).toEqual({ method: 'CASH', amountReceived: '1500.25' });
  });

  it('CARD/TRANSFER/OTHER never carry amountReceived', () => {
    expect(buildTenderInput('CARD', '18500')).toEqual({ method: 'CARD' });
    expect(buildTenderInput('TRANSFER', '18500')).toEqual({ method: 'TRANSFER' });
    expect(buildTenderInput('OTHER', '18500')).toEqual({ method: 'OTHER' });
  });
});
