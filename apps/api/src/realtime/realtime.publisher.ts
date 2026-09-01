import { Injectable, Logger } from '@nestjs/common';
import { companyRealtimeRoom } from '@erp/shared';
import type { RealtimeEventName, RealtimeEventPayloads } from '@erp/shared';
import { RealtimeGateway } from './realtime.gateway';

/**
 * The one place domain services reach to notify other workstations — see
 * docs/desktop-lan-architecture.md "Realtime architecture". Domain
 * services never touch Socket.IO's `Server` directly; they call one of
 * these typed methods, always AFTER their own `$transaction` has
 * resolved (i.e. committed). A failed/rolled-back mutation must never
 * call this — see each call site for why that's already guaranteed by
 * only calling these methods after `await this.prisma.$transaction(...)`
 * returns successfully.
 *
 * Every payload is a minimal invalidation hint (ids + companyId only,
 * see realtime.ts) — never a full entity, never a computed
 * balance/total. A publish failure (e.g. gateway not yet initialized)
 * must never break the business mutation that triggered it, so this
 * never throws.
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger('Realtime');

  constructor(private readonly gateway: RealtimeGateway) {}

  saleConfirmed(companyId: string, saleId: string): void {
    this.publish(companyId, 'sale.confirmed', { companyId, saleId });
  }

  saleCancelled(companyId: string, saleId: string): void {
    this.publish(companyId, 'sale.cancelled', { companyId, saleId });
  }

  stockChanged(
    companyId: string,
    warehouseId: string,
    productVariantId: string,
  ): void {
    this.publish(companyId, 'stock.changed', {
      companyId,
      warehouseId,
      productVariantId,
    });
  }

  customerUpdated(companyId: string, customerId: string): void {
    this.publish(companyId, 'customer.updated', { companyId, customerId });
  }

  productUpdated(companyId: string, productId: string): void {
    this.publish(companyId, 'product.updated', { companyId, productId });
  }

  priceChanged(
    companyId: string,
    priceListId: string,
    productVariantId?: string,
  ): void {
    this.publish(companyId, 'price.changed', {
      companyId,
      priceListId,
      productVariantId,
    });
  }

  purchaseOrderConfirmed(companyId: string, purchaseOrderId: string): void {
    this.publish(companyId, 'purchase-order.confirmed', {
      companyId,
      purchaseOrderId,
    });
  }

  purchaseOrderCancelled(companyId: string, purchaseOrderId: string): void {
    this.publish(companyId, 'purchase-order.cancelled', {
      companyId,
      purchaseOrderId,
    });
  }

  purchaseReceiptConfirmed(companyId: string, purchaseReceiptId: string): void {
    this.publish(companyId, 'purchase-receipt.confirmed', {
      companyId,
      purchaseReceiptId,
    });
  }

  purchaseReceiptCancelled(companyId: string, purchaseReceiptId: string): void {
    this.publish(companyId, 'purchase-receipt.cancelled', {
      companyId,
      purchaseReceiptId,
    });
  }

  customerAccountChanged(companyId: string, customerId: string): void {
    this.publish(companyId, 'customer-account.changed', {
      companyId,
      customerId,
    });
  }

  supplierAccountChanged(companyId: string, supplierId: string): void {
    this.publish(companyId, 'supplier-account.changed', {
      companyId,
      supplierId,
    });
  }

  collectionConfirmed(companyId: string, collectionId: string): void {
    this.publish(companyId, 'collection.confirmed', {
      companyId,
      collectionId,
    });
  }

  collectionCancelled(companyId: string, collectionId: string): void {
    this.publish(companyId, 'collection.cancelled', {
      companyId,
      collectionId,
    });
  }

  supplierPaymentConfirmed(companyId: string, supplierPaymentId: string): void {
    this.publish(companyId, 'supplier-payment.confirmed', {
      companyId,
      supplierPaymentId,
    });
  }

  supplierPaymentCancelled(companyId: string, supplierPaymentId: string): void {
    this.publish(companyId, 'supplier-payment.cancelled', {
      companyId,
      supplierPaymentId,
    });
  }

  private publish<E extends RealtimeEventName>(
    companyId: string,
    event: E,
    payload: RealtimeEventPayloads[E],
  ): void {
    const server = this.gateway.server;
    if (!server) {
      // Realtime is best-effort by design (see AGENTS.md-level invariant:
      // it must never gate a business mutation's success). Not yet having
      // a Socket.IO server up (e.g. very early during bootstrap) is a
      // no-op, not an error.
      this.logger.warn({
        event: 'publish_skipped_no_server',
        realtimeEvent: event,
      });
      return;
    }
    server.to(companyRealtimeRoom(companyId)).emit(event, payload);
  }
}
