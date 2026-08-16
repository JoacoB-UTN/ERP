import { compareDecimalStrings, isDecimalString, subtractDecimalStrings } from '@erp/shared';
import type { ConfirmSaleTenderInput, SalesTenderMethod } from '@erp/shared';

/**
 * Decimal-string cash-checkout math for the POS payment panel — see
 * docs/pos.md and AGENTS.md's "never floating point for money" rule.
 * `total` and `receivedInput` are both decimal strings; the arithmetic
 * runs entirely through `@erp/shared`'s BigInt-backed decimal helpers —
 * `Number()`/`parseFloat()` never touch either value. An empty
 * `receivedInput` means "exact payment" (received = total, change 0),
 * matching the panel's placeholder behavior. `insufficient` mirrors the
 * backend's own `SALE_TENDER_CASH_INSUFFICIENT` rule so the operator
 * sees it before ever submitting.
 */
export function resolveCashTender(
  total: string,
  receivedInput: string,
): { received: string; change: string; insufficient: boolean } {
  const trimmed = receivedInput.trim();
  if (trimmed === '') {
    return { received: total, change: subtractDecimalStrings(total, total), insufficient: false };
  }
  if (!isDecimalString(trimmed)) {
    return { received: trimmed, change: '0', insufficient: true };
  }
  return {
    received: trimmed,
    change: subtractDecimalStrings(trimmed, total),
    insufficient: compareDecimalStrings(trimmed, total) < 0,
  };
}

/** `amountApplied` is never sent — the backend always derives it from the sale's own total. `received` is the original normalized decimal string, never a value round-tripped through `Number()`. See docs/pos.md. */
export function buildTenderInput(method: SalesTenderMethod, received: string): ConfirmSaleTenderInput {
  return method === 'CASH' ? { method, amountReceived: received } : { method };
}
