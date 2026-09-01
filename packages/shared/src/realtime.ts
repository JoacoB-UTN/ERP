/**
 * Realtime (Socket.IO) event contract — see docs/desktop-lan-architecture.md
 * "Realtime architecture". Shared between apps/api (publisher) and both
 * frontends (invalidation mapping) so the wire shape can never drift
 * between producer and consumer.
 *
 * CRITICAL: these events are invalidation HINTS ONLY, never authoritative
 * data. A payload carries just enough identity to know what to refetch —
 * never a full entity, never a computed balance/total. The client always
 * re-asks the normal, permission-checked REST API for real data.
 */

export const REALTIME_EVENTS = [
  'sale.confirmed',
  'sale.cancelled',
  'stock.changed',
  'customer.updated',
  'product.updated',
  'price.changed',
  'purchase-order.confirmed',
  'purchase-order.cancelled',
  'purchase-receipt.confirmed',
  'purchase-receipt.cancelled',
  'customer-account.changed',
  'supplier-account.changed',
  'collection.confirmed',
  'collection.cancelled',
  'supplier-payment.confirmed',
  'supplier-payment.cancelled',
] as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];

export interface SaleConfirmedEvent {
  companyId: string;
  saleId: string;
}

export interface SaleCancelledEvent {
  companyId: string;
  saleId: string;
}

export interface StockChangedEvent {
  companyId: string;
  warehouseId: string;
  productVariantId: string;
}

export interface CustomerUpdatedEvent {
  companyId: string;
  customerId: string;
}

export interface ProductUpdatedEvent {
  companyId: string;
  productId: string;
}

export interface PriceChangedEvent {
  companyId: string;
  priceListId: string;
  /** Omitted for a batch/bulk price change affecting many variants at once. */
  productVariantId?: string;
}

export interface PurchaseOrderConfirmedEvent {
  companyId: string;
  purchaseOrderId: string;
}

export interface PurchaseOrderCancelledEvent {
  companyId: string;
  purchaseOrderId: string;
}

export interface PurchaseReceiptConfirmedEvent {
  companyId: string;
  purchaseReceiptId: string;
}

export interface PurchaseReceiptCancelledEvent {
  companyId: string;
  purchaseReceiptId: string;
}

/** See docs/current-accounts.md. Published after ANY commit that posts a CustomerAccountMovement for this customer (sale confirm, collection confirm/cancel). */
export interface CustomerAccountChangedEvent {
  companyId: string;
  customerId: string;
}

/** Symmetric to CustomerAccountChangedEvent — published after a SupplierAccountMovement post (receipt confirm/cancel, supplier payment confirm/cancel). */
export interface SupplierAccountChangedEvent {
  companyId: string;
  supplierId: string;
}

export interface CollectionConfirmedEvent {
  companyId: string;
  collectionId: string;
}

export interface CollectionCancelledEvent {
  companyId: string;
  collectionId: string;
}

export interface SupplierPaymentConfirmedEvent {
  companyId: string;
  supplierPaymentId: string;
}

export interface SupplierPaymentCancelledEvent {
  companyId: string;
  supplierPaymentId: string;
}

/** Maps each event name to its exact payload shape — used by both the API publisher and the frontend listener so neither side can drift. */
export interface RealtimeEventPayloads {
  'sale.confirmed': SaleConfirmedEvent;
  'sale.cancelled': SaleCancelledEvent;
  'stock.changed': StockChangedEvent;
  'customer.updated': CustomerUpdatedEvent;
  'product.updated': ProductUpdatedEvent;
  'price.changed': PriceChangedEvent;
  'purchase-order.confirmed': PurchaseOrderConfirmedEvent;
  'purchase-order.cancelled': PurchaseOrderCancelledEvent;
  'purchase-receipt.confirmed': PurchaseReceiptConfirmedEvent;
  'purchase-receipt.cancelled': PurchaseReceiptCancelledEvent;
  'customer-account.changed': CustomerAccountChangedEvent;
  'supplier-account.changed': SupplierAccountChangedEvent;
  'collection.confirmed': CollectionConfirmedEvent;
  'collection.cancelled': CollectionCancelledEvent;
  'supplier-payment.confirmed': SupplierPaymentConfirmedEvent;
  'supplier-payment.cancelled': SupplierPaymentCancelledEvent;
}

/**
 * Company-scoped Socket.IO room name. A user only ever joins the room for
 * a company whose membership the server has independently validated (see
 * CompanyContextService.validateCompanyAccess) — never a client-supplied
 * companyId taken on faith.
 */
export function companyRealtimeRoom(companyId: string): string {
  return `company:${companyId}`;
}

/** Client → server: request to (re)subscribe to one company's room. Server re-validates membership before joining — see realtime.gateway.ts. */
export const REALTIME_SUBSCRIBE_COMPANY = 'company:subscribe' as const;

export interface SubscribeCompanyPayload {
  companyId: string;
}

export interface SubscribeCompanyAck {
  ok: boolean;
  companyId?: string;
  error?: string;
}
