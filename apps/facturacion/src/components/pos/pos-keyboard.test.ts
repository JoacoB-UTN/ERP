import { describe, expect, it } from 'vitest';
import { resolvePosKeydownAction, type PosKeydownContext } from './pos-keyboard';

function ctx(overrides: Partial<PosKeydownContext> = {}): PosKeydownContext {
  return {
    key: 'a',
    inField: false,
    modalActive: false,
    hasActiveKey: false,
    canOpenCheckout: false,
    ...overrides,
  };
}

describe('resolvePosKeydownAction', () => {
  it('F2 toggles the customer picker outside the payment dialog', () => {
    expect(resolvePosKeydownAction(ctx({ key: 'F2' }))).toEqual({ type: 'toggle-customer' });
  });

  it('F2 is a no-op while the payment dialog is open/opening/confirming', () => {
    expect(resolvePosKeydownAction(ctx({ key: 'F2', modalActive: true }))).toBeNull();
  });

  it('F10 opens checkout when eligible', () => {
    expect(resolvePosKeydownAction(ctx({ key: 'F10', canOpenCheckout: true }))).toEqual({
      type: 'open-checkout',
    });
  });

  it('F10 is a no-op when checkout is not eligible (no customer, empty cart, no permission, ...)', () => {
    expect(resolvePosKeydownAction(ctx({ key: 'F10', canOpenCheckout: false }))).toBeNull();
  });

  it('F10 never opens a second checkout while the payment dialog is already active, even if otherwise eligible', () => {
    expect(
      resolvePosKeydownAction(ctx({ key: 'F10', canOpenCheckout: true, modalActive: true })),
    ).toBeNull();
  });

  it('+ bumps the active line up when not typing in a field and the dialog is closed', () => {
    expect(resolvePosKeydownAction(ctx({ key: '+', hasActiveKey: true }))).toEqual({
      type: 'bump-quantity',
      delta: 1,
    });
  });

  it('- bumps the active line down', () => {
    expect(resolvePosKeydownAction(ctx({ key: '-', hasActiveKey: true }))).toEqual({
      type: 'bump-quantity',
      delta: -1,
    });
  });

  it('Delete removes the active line', () => {
    expect(resolvePosKeydownAction(ctx({ key: 'Delete', hasActiveKey: true }))).toEqual({
      type: 'remove-line',
    });
  });

  it('+/-/Delete are no-ops with no active line', () => {
    expect(resolvePosKeydownAction(ctx({ key: '+', hasActiveKey: false }))).toBeNull();
    expect(resolvePosKeydownAction(ctx({ key: '-', hasActiveKey: false }))).toBeNull();
    expect(resolvePosKeydownAction(ctx({ key: 'Delete', hasActiveKey: false }))).toBeNull();
  });

  // The exact case flagged by external review: quantity edits and line
  // removal must never fire while focus is inside ProductSearch,
  // CustomerPicker, or the payment panel's "Recibido" input — regardless
  // of whether the dialog itself happens to be open.
  it('+/-/Delete never hijack normal typing in a text field', () => {
    expect(resolvePosKeydownAction(ctx({ key: '+', hasActiveKey: true, inField: true }))).toBeNull();
    expect(resolvePosKeydownAction(ctx({ key: '-', hasActiveKey: true, inField: true }))).toBeNull();
    expect(
      resolvePosKeydownAction(ctx({ key: 'Delete', hasActiveKey: true, inField: true })),
    ).toBeNull();
  });

  it('+/-/Delete are no-ops while the payment dialog owns keyboard interaction', () => {
    expect(
      resolvePosKeydownAction(ctx({ key: '+', hasActiveKey: true, modalActive: true })),
    ).toBeNull();
    expect(
      resolvePosKeydownAction(ctx({ key: '-', hasActiveKey: true, modalActive: true })),
    ).toBeNull();
    expect(
      resolvePosKeydownAction(ctx({ key: 'Delete', hasActiveKey: true, modalActive: true })),
    ).toBeNull();
  });

  it('unrelated keys resolve to no action', () => {
    expect(resolvePosKeydownAction(ctx({ key: 'a' }))).toBeNull();
    expect(resolvePosKeydownAction(ctx({ key: 'Enter' }))).toBeNull();
  });
});
