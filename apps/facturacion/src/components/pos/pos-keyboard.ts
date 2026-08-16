export type PosKeydownAction =
  | { type: 'toggle-customer' }
  | { type: 'open-checkout' }
  | { type: 'bump-quantity'; delta: 1 | -1 }
  | { type: 'remove-line' };

export interface PosKeydownContext {
  key: string;
  /** Focus is in a text input/textarea (ProductSearch, CustomerPicker, the payment panel's "Recibido" field, ...) — normal typing must never be hijacked. */
  inField: boolean;
  /** The payment dialog is open, opening, or confirming — it owns keyboard interaction; global shortcuts must not touch the customer/cart behind it. */
  modalActive: boolean;
  hasActiveKey: boolean;
  canOpenCheckout: boolean;
}

/**
 * Pure decision function for POS's global keyboard shortcuts (F2/F10/+/-/
 * Delete) — see docs/pos.md. Deliberately takes every input as an
 * explicit argument instead of closing over component state, so it can
 * never suffer the F10 stale-closure bug found during external review
 * (the caller must evaluate `canOpenCheckout`/`modalActive`/etc. fresh on
 * every keydown against the CURRENT customer/cart/draft state — this
 * function only decides which action that state implies, it never reads
 * or caches state itself).
 */
export function resolvePosKeydownAction(ctx: PosKeydownContext): PosKeydownAction | null {
  if (ctx.key === 'F2') {
    return ctx.modalActive ? null : { type: 'toggle-customer' };
  }
  if (ctx.key === 'F10') {
    return ctx.modalActive || !ctx.canOpenCheckout ? null : { type: 'open-checkout' };
  }
  if (ctx.inField || ctx.modalActive) return null;
  if (ctx.key === '+' && ctx.hasActiveKey) return { type: 'bump-quantity', delta: 1 };
  if (ctx.key === '-' && ctx.hasActiveKey) return { type: 'bump-quantity', delta: -1 };
  if (ctx.key === 'Delete' && ctx.hasActiveKey) return { type: 'remove-line' };
  return null;
}
