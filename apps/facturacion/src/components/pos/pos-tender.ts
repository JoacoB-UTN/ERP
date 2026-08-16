import type { ConfirmSaleTenderInput, SalesTenderMethod } from '@erp/shared';

/**
 * Pure cash-checkout math for the POS payment panel — see docs/pos.md.
 * An empty `receivedInput` means "exact payment" (received = total, change
 * 0), matching the panel's placeholder behavior. `insufficient` mirrors
 * the backend's own `SALE_TENDER_CASH_INSUFFICIENT` rule so the operator
 * sees it before ever submitting.
 */
export function resolveCashTender(
  total: number,
  receivedInput: string,
): { receivedNum: number; change: number; insufficient: boolean } {
  const receivedNum = receivedInput.trim() === '' ? total : Number(receivedInput);
  const change = receivedNum - total;
  const insufficient = !Number.isFinite(receivedNum) || change < 0;
  return { receivedNum, change, insufficient };
}

/** `amountApplied` is never sent — the backend always derives it from the sale's own total. See docs/pos.md. */
export function buildTenderInput(method: SalesTenderMethod, receivedNum: number): ConfirmSaleTenderInput {
  return method === 'CASH' ? { method, amountReceived: String(receivedNum) } : { method };
}
