'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Check, Ban } from 'lucide-react';
import { formatDecimalDisplay, formatMoney, salesDocumentStatusLabel, salesTenderMethodLabel } from '@erp/shared';
import { usePermissions, useSale, useConfirmSale, useCancelSale } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { saleErrorMessage } from '@/components/sales/sales-errors';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' });
}

function qty(value: string): string {
  return formatDecimalDisplay(value, 6) ?? value;
}

export default function VentaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const saleQuery = useSale(id ?? null);
  const confirmSale = useConfirmSale();
  const cancelSale = useCancelSale();
  const [actionError, setActionError] = useState<string | undefined>();

  if (permissionsLoading || saleQuery.isLoading) {
    return null;
  }
  if (!can('sales.documents.read')) {
    return <Unauthorized />;
  }
  const sale = saleQuery.data?.salesDocument;
  if (!sale) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/ventas" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Volver a ventas
        </Link>
        <p className="text-muted-foreground">No se encontró la venta.</p>
      </div>
    );
  }

  const canEdit = sale.status === 'DRAFT' && can('sales.documents.update');
  const canConfirm = sale.status === 'DRAFT' && can('sales.documents.confirm');
  const canCancel = sale.status === 'DRAFT' && can('sales.documents.cancel');

  async function handleConfirm() {
    if (!sale) return;
    const ok = window.confirm(
      `¿Confirmar la venta ${sale.number}?\n\nEsta operación descontará stock del depósito seleccionado.`,
    );
    if (!ok) return;
    setActionError(undefined);
    try {
      await confirmSale.mutateAsync({ id: sale.id });
    } catch (err) {
      setActionError(saleErrorMessage(err));
    }
  }

  async function handleCancel() {
    if (!sale) return;
    const ok = window.confirm(`¿Cancelar el borrador ${sale.number}? No se generó ningún movimiento todavía.`);
    if (!ok) return;
    setActionError(undefined);
    try {
      await cancelSale.mutateAsync(sale.id);
      router.push('/ventas');
    } catch (err) {
      setActionError(saleErrorMessage(err));
    }
  }

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <PageHeader
        eyebrow="Venta interna"
        title={<span className="flex flex-wrap items-center gap-2">{sale.number}<StatusBadge status={sale.status}>{salesDocumentStatusLabel(sale.status)}</StatusBadge></span>}
        description={`${sale.customer.legalName} · ${sale.warehouse.name} · ${formatDateTime(sale.occurredAt)}`}
        backHref="/ventas"
        backLabel="Ventas"
        actions={(canEdit || canConfirm || canCancel) && <>
          {canEdit && (
            <Link href={`/ventas/${sale.id}/editar`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil className="size-4" />
              Editar
            </Link>
          )}
          {canConfirm && (
            <Button type="button" onClick={handleConfirm} disabled={confirmSale.isPending}>
              <Check className="size-4" />
              {confirmSale.isPending ? 'Confirmando…' : 'Confirmar venta'}
            </Button>
          )}
          {canCancel && (
            <Button type="button" variant="destructive" onClick={handleCancel} disabled={cancelSale.isPending}>
              <Ban className="size-4" />
              Cancelar borrador
            </Button>
          )}
        </>}
      />
      {actionError && <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-muted px-3 py-2 text-sm text-destructive">{actionError}</p>}

      <div className="rounded-md border border-border bg-card p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Lista de precios</dt>
            <dd className="mt-0.5">{sale.priceList.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Creado por</dt>
            <dd className="mt-0.5">{sale.createdBy?.name ?? 'Sistema'}</dd>
          </div>
          {sale.status === 'CONFIRMED' && sale.confirmedAt && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Confirmada</dt>
              <dd className="mt-0.5">
                {formatDateTime(sale.confirmedAt)} · {sale.confirmedBy?.name ?? 'Sistema'}
              </dd>
            </div>
          )}
          {sale.status === 'CONFIRMED' && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Efecto en inventario</dt>
              <dd className="mt-0.5">
                <Link
                  href={`/stock/movimientos?warehouseId=${sale.warehouse.id}&referenceType=SalesDocument`}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  Ver movimientos de stock
                </Link>
              </dd>
            </div>
          )}
          {sale.tender && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Método de pago</dt>
              <dd className="mt-0.5">
                {salesTenderMethodLabel(sale.tender.method)}
                {sale.tender.amountReceived && sale.tender.change && (
                  <span className="text-muted-foreground">
                    {' '}
                    · Recibido {formatMoney(sale.tender.amountReceived, sale.currencyCode)} · Vuelto{' '}
                    {formatMoney(sale.tender.change, sale.currencyCode)}
                  </span>
                )}
              </dd>
            </div>
          )}
          {sale.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notas</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{sale.notes}</dd>
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
              <th className="px-4 py-2 text-right">Precio unit.</th>
              <th className="px-4 py-2 text-right">Descuento</th>
              <th className="px-4 py-2 text-right">Total línea</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className="px-4 py-2">
                  {line.description}
                  {line.sku && <p className="text-xs text-muted-foreground">{line.sku}</p>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{qty(line.quantity)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(line.unitPrice, sale.currencyCode)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {Number(line.discountPercentage) > 0
                    ? `${formatDecimalDisplay(line.discountPercentage, 2)}% (${formatMoney(line.discountAmount, sale.currencyCode)})`
                    : '—'}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">
                  {formatMoney(line.totalAmount, sale.currencyCode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto flex w-full max-w-sm flex-col gap-1.5 rounded-md border border-border bg-card p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatMoney(sale.subtotal, sale.currencyCode)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Descuentos</span>
          <span className="tabular-nums">{formatMoney(sale.discountTotal, sale.currencyCode)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(sale.total, sale.currencyCode)}</span>
        </div>
      </div>
    </div>
  );
}
