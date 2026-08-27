'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Check, Ban } from 'lucide-react';
import { formatMoney, formatDecimalDisplay, purchaseReceiptStatusLabel } from '@erp/shared';
import {
  usePermissions,
  usePurchaseReceipt,
  useConfirmPurchaseReceipt,
  useCancelPurchaseReceipt,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
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

export default function RecepcionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const receiptQuery = usePurchaseReceipt(id ?? null);
  const confirmReceipt = useConfirmPurchaseReceipt();
  const cancelReceipt = useCancelPurchaseReceipt();
  const [actionError, setActionError] = useState<string | undefined>();

  if (permissionsLoading || receiptQuery.isLoading) {
    return null;
  }
  if (!can('purchases.goods-receipts.read')) {
    return <Unauthorized />;
  }
  const receipt = receiptQuery.data?.purchaseReceipt;
  if (!receipt) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/compras/recepciones" className="text-sm text-muted-foreground hover:text-foreground">
          Volver a recepciones
        </Link>
        <p className="text-muted-foreground">No se encontró la recepción.</p>
      </div>
    );
  }

  const canConfirm = receipt.status === 'DRAFT' && can('purchases.goods-receipts.confirm');
  const canCancel =
    (receipt.status === 'DRAFT' || receipt.status === 'CONFIRMED') && can('purchases.goods-receipts.cancel');

  async function handleConfirm() {
    if (!receipt) return;
    const ok = window.confirm(
      `¿Confirmar la recepción ${receipt.number}?\n\nEsta operación sumará stock al depósito seleccionado.`,
    );
    if (!ok) return;
    setActionError(undefined);
    try {
      await confirmReceipt.mutateAsync(receipt.id);
    } catch (err) {
      setActionError(purchaseErrorMessage(err));
    }
  }

  async function handleCancel() {
    if (!receipt) return;
    const message =
      receipt.status === 'CONFIRMED'
        ? `¿Anular la recepción ${receipt.number}?\n\nEsto revertirá el stock que sumó, generando un movimiento de reversión — el movimiento original nunca se borra.`
        : `¿Anular el borrador ${receipt.number}? No se generó ningún movimiento todavía.`;
    const ok = window.confirm(message);
    if (!ok) return;
    setActionError(undefined);
    try {
      await cancelReceipt.mutateAsync(receipt.id);
    } catch (err) {
      setActionError(purchaseErrorMessage(err));
    }
  }

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <PageHeader
        eyebrow="Recepción de mercadería"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {receipt.number}
            <StatusBadge status={receipt.status}>{purchaseReceiptStatusLabel(receipt.status)}</StatusBadge>
          </span>
        }
        description={`${receipt.supplier.legalName} · ${receipt.warehouse.name} · ${formatDate(receipt.receiptDate)}`}
        backHref="/compras/recepciones"
        backLabel="Recepciones"
        actions={
          (canConfirm || canCancel) && (
            <>
              {canConfirm && (
                <Button type="button" onClick={handleConfirm} disabled={confirmReceipt.isPending}>
                  <Check className="size-4" />
                  {confirmReceipt.isPending ? 'Confirmando…' : 'Confirmar recepción'}
                </Button>
              )}
              {canCancel && (
                <Button type="button" variant="destructive" onClick={handleCancel} disabled={cancelReceipt.isPending}>
                  <Ban className="size-4" />
                  Anular
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
            <dt className="text-xs font-medium text-muted-foreground">Orden de origen</dt>
            <dd className="mt-0.5">
              {receipt.purchaseOrder ? (
                <Link
                  href={`/compras/ordenes/${receipt.purchaseOrder.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {receipt.purchaseOrder.number}
                </Link>
              ) : (
                'Recepción directa'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Creado por</dt>
            <dd className="mt-0.5">{receipt.createdBy?.name ?? 'Sistema'}</dd>
          </div>
          {receipt.status !== 'DRAFT' && receipt.confirmedAt && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Confirmada</dt>
              <dd className="mt-0.5">
                {formatDateTime(receipt.confirmedAt)} · {receipt.confirmedBy?.name ?? 'Sistema'}
              </dd>
            </div>
          )}
          {receipt.status === 'CONFIRMED' && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Efecto en inventario</dt>
              <dd className="mt-0.5">
                <Link
                  href={`/stock/movimientos?warehouseId=${receipt.warehouse.id}&referenceType=PurchaseReceipt`}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  Ver movimientos de stock
                </Link>
              </dd>
            </div>
          )}
          {receipt.status === 'CANCELLED' && receipt.cancelledAt && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Anulada</dt>
              <dd className="mt-0.5">
                {formatDateTime(receipt.cancelledAt)} · {receipt.cancelledBy?.name ?? 'Sistema'}
              </dd>
            </div>
          )}
          {receipt.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notas</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{receipt.notes}</dd>
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
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className="px-4 py-2">
                  {line.description}
                  {line.sku && <p className="text-xs text-muted-foreground">{line.sku}</p>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{qty(line.quantity)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatMoney(line.unitCostSnapshot, receipt.currencyCode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
