'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Check, Ban, PackagePlus } from 'lucide-react';
import {
  formatMoney,
  formatDecimalDisplay,
  purchaseOrderStatusLabel,
  purchaseReceiptStatusLabel,
} from '@erp/shared';
import { usePermissions, usePurchaseOrder, useConfirmPurchaseOrder, useCancelPurchaseOrder } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { purchaseErrorMessage } from '@/components/compras/purchases-errors';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'long' });
}
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' });
}
function qty(value: string): string {
  return formatDecimalDisplay(value, 6) ?? value;
}

export default function OrdenDeCompraDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const orderQuery = usePurchaseOrder(id ?? null);
  const confirmOrder = useConfirmPurchaseOrder();
  const cancelOrder = useCancelPurchaseOrder();
  const [actionError, setActionError] = useState<string | undefined>();

  if (permissionsLoading || orderQuery.isLoading) {
    return null;
  }
  if (!can('purchases.orders.read')) {
    return <Unauthorized />;
  }
  const order = orderQuery.data?.purchaseOrder;
  if (!order) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/compras/ordenes" className="text-sm text-muted-foreground hover:text-foreground">
          Volver a órdenes de compra
        </Link>
        <p className="text-muted-foreground">No se encontró la orden de compra.</p>
      </div>
    );
  }

  const canConfirm = order.status === 'DRAFT' && can('purchases.orders.approve');
  const canCancel = order.status === 'DRAFT' && can('purchases.orders.cancel');
  const canReceive = order.status === 'CONFIRMED' && can('purchases.goods-receipts.create');

  async function handleConfirm() {
    if (!order) return;
    const ok = window.confirm(
      `¿Confirmar la orden ${order.number}?\n\nEsto compromete la compra con el proveedor, pero no afecta el stock.`,
    );
    if (!ok) return;
    setActionError(undefined);
    try {
      await confirmOrder.mutateAsync(order.id);
    } catch (err) {
      setActionError(purchaseErrorMessage(err));
    }
  }

  async function handleCancel() {
    if (!order) return;
    const ok = window.confirm(`¿Anular el borrador ${order.number}?`);
    if (!ok) return;
    setActionError(undefined);
    try {
      await cancelOrder.mutateAsync(order.id);
    } catch (err) {
      setActionError(purchaseErrorMessage(err));
    }
  }

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <PageHeader
        eyebrow="Orden de compra"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {order.number}
            <StatusBadge status={order.status}>{purchaseOrderStatusLabel(order.status)}</StatusBadge>
          </span>
        }
        description={`${order.supplier.legalName} · ${formatDate(order.orderDate)}`}
        backHref="/compras/ordenes"
        backLabel="Órdenes de compra"
        actions={
          (canConfirm || canCancel || canReceive) && (
            <>
              {canReceive && (
                <Link
                  href={`/compras/recepciones/nueva?purchaseOrderId=${order.id}`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  <PackagePlus className="size-4" />
                  Recibir mercadería
                </Link>
              )}
              {canConfirm && (
                <Button type="button" onClick={handleConfirm} disabled={confirmOrder.isPending}>
                  <Check className="size-4" />
                  {confirmOrder.isPending ? 'Confirmando…' : 'Confirmar orden'}
                </Button>
              )}
              {canCancel && (
                <Button type="button" variant="destructive" onClick={handleCancel} disabled={cancelOrder.isPending}>
                  <Ban className="size-4" />
                  Anular borrador
                </Button>
              )}
            </>
          )
        }
      />
      {actionError && (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-muted px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      <div className="rounded-md border border-border bg-card p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Moneda</dt>
            <dd className="mt-0.5">{order.currencyCode}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Creado por</dt>
            <dd className="mt-0.5">{order.createdBy?.name ?? 'Sistema'}</dd>
          </div>
          {order.expectedDeliveryDate && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Entrega estimada</dt>
              <dd className="mt-0.5">{formatDate(order.expectedDeliveryDate)}</dd>
            </div>
          )}
          {order.status === 'CONFIRMED' && order.confirmedAt && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Confirmada</dt>
              <dd className="mt-0.5">
                {formatDateTime(order.confirmedAt)} · {order.confirmedBy?.name ?? 'Sistema'}
              </dd>
            </div>
          )}
          {order.status === 'CANCELLED' && order.cancelledAt && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Anulada</dt>
              <dd className="mt-0.5">
                {formatDateTime(order.cancelledAt)} · {order.cancelledBy?.name ?? 'Sistema'}
              </dd>
            </div>
          )}
          {order.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notas</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{order.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2 text-right">Cantidad</th>
              <th className="px-4 py-2 text-right">Costo unit.</th>
              <th className="px-4 py-2 text-right">Total línea</th>
              <th className="px-4 py-2 text-right">Recibido</th>
              <th className="px-4 py-2 text-right">Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className="px-4 py-2">
                  {line.description}
                  {line.sku && <p className="text-xs text-muted-foreground">{line.sku}</p>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{qty(line.quantity)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(line.unitCost, order.currencyCode)}</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">
                  {formatMoney(line.lineTotal, order.currencyCode)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{qty(line.receivedQuantity)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  <span className={Number(line.pendingQuantity) > 0 ? 'font-medium text-primary' : 'text-muted-foreground'}>
                    {qty(line.pendingQuantity)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto flex w-full max-w-sm flex-col gap-1.5 rounded-md border border-border bg-card p-4 text-sm">
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(order.total, order.currencyCode)}</span>
        </div>
      </div>

      {order.receipts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Recepciones</h2>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Número</th>
                  <th className="px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {order.receipts.map((receipt) => (
                  <tr key={receipt.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <Link
                        href={`/compras/recepciones/${receipt.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {receipt.number}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={receipt.status}>{purchaseReceiptStatusLabel(receipt.status)}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
