import { z } from 'zod';
import type { PaginationMeta } from './api';

/**
 * Supplier Current Account (Operational Accounts Payable) — read model
 * over the immutable SupplierAccountMovement ledger. See
 * docs/current-accounts.md. Symmetric to accounts-receivable.ts.
 *
 * Sign convention: a POSITIVE balance means the company owes the
 * supplier money. PURCHASE_RECEIPT_ACCRUAL is always +,
 * PURCHASE_RECEIPT_REVERSAL/SUPPLIER_PAYMENT are always -,
 * SUPPLIER_PAYMENT_REVERSAL is always +.
 */

export const supplierAccountListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type SupplierAccountListQuery = z.infer<typeof supplierAccountListQuerySchema>;

export const supplierStatementQuerySchema = z.object({
  currencyId: z.string().uuid('Elegí una moneda.'),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export type SupplierStatementQuery = z.infer<typeof supplierStatementQuerySchema>;

export const supplierOpenReceiptsQuerySchema = z.object({
  currencyId: z.string().uuid('Elegí una moneda.'),
});
export type SupplierOpenReceiptsQuery = z.infer<typeof supplierOpenReceiptsQuerySchema>;

// ---------- Response DTOs ----------

export interface SupplierCurrencyBalance {
  currencyId: string;
  currencyCode: string;
  /** Signed — see the module doc comment's sign convention. */
  balance: string;
}

export interface SupplierAccountSummary {
  supplierId: string;
  code: string;
  legalName: string;
  displayName: string;
  taxId: string | null;
  taxIdFormatted: string | null;
  balances: SupplierCurrencyBalance[];
  lastMovementAt: string | null;
}

export interface SupplierAccountListResponse {
  items: SupplierAccountSummary[];
  pagination: PaginationMeta;
}

/** Same Debe/Haber convention as accounts-receivable.ts's CustomerAccountMovementDto. */
export interface SupplierAccountMovementDto {
  id: string;
  occurredAt: string;
  movementType: string;
  sourceType: string;
  sourceId: string;
  description: string | null;
  debit: string;
  credit: string;
  amount: string;
  runningBalance: string;
}

export interface SupplierStatementResponse {
  supplier: { id: string; code: string; legalName: string; displayName: string };
  currencyId: string;
  currencyCode: string;
  openingBalance: string;
  closingBalance: string;
  items: SupplierAccountMovementDto[];
}

export interface SupplierOpenReceiptDto {
  id: string;
  number: string;
  receiptDate: string;
  total: string;
  outstanding: string;
}

export interface SupplierOpenReceiptsResponse {
  currencyId: string;
  currencyCode: string;
  items: SupplierOpenReceiptDto[];
}

export interface PurchaseReceiptOutstandingResponse {
  purchaseReceiptId: string;
  currencyCode: string;
  total: string;
  outstanding: string;
}

// ---------- Spanish presentation layer ----------

/** Symmetric to CUSTOMER_ACCOUNT_MOVEMENT_LABELS — see accounts-receivable.ts. */
export const SUPPLIER_ACCOUNT_MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT_ACCRUAL: 'Recepción',
  PURCHASE_RECEIPT_REVERSAL: 'Anulación de recepción',
  SUPPLIER_PAYMENT: 'Pago',
  SUPPLIER_PAYMENT_REVERSAL: 'Anulación de pago',
  PURCHASE_INVOICE: 'Factura de compra',
  PURCHASE_CREDIT_NOTE: 'Nota de crédito de compra',
  OPENING_BALANCE: 'Saldo inicial',
  ADJUSTMENT: 'Ajuste',
};

export function supplierAccountMovementLabel(value: string): string {
  return SUPPLIER_ACCOUNT_MOVEMENT_LABELS[value] ?? value;
}
