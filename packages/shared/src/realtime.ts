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

/** Maps each event name to its exact payload shape — used by both the API publisher and the frontend listener so neither side can drift. */
export interface RealtimeEventPayloads {
  'sale.confirmed': SaleConfirmedEvent;
  'sale.cancelled': SaleCancelledEvent;
  'stock.changed': StockChangedEvent;
  'customer.updated': CustomerUpdatedEvent;
  'product.updated': ProductUpdatedEvent;
  'price.changed': PriceChangedEvent;
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
