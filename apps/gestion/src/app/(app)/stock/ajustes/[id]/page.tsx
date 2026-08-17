'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Check, Ban } from 'lucide-react';
import { formatDecimalDisplay, stockAdjustmentStatusLabel } from '@erp/shared';
import {
  usePermissions,
  useStockAdjustment,
  useConfirmStockAdjustment,
  useCancelStockAdjustment,
} from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { stockErrorMessage } from '@/components/stock/stock-errors';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' });
}

function qty(value: string): string {
  return formatDecimalDisplay(value, 6) ?? value;
}

function statusClassName(status: string): string {
  if (status === 'CONFIRMED') return 'text-emerald-600';
  if (status === 'CANCELLED') return 'text-muted-foreground';
  return 'text-amber-600';
}

export default function AjusteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const adjustmentQuery = useStockAdjustment(id ?? null);
  const confirmAdjustment = useConfirmStockAdjustment();
  const cancelAdjustment = useCancelStockAdjustment();
  const [actionError, setActionError] = useState<string | undefined>();

  if (permissionsLoading || adjustmentQuery.isLoading) {
    return null;
  }
  if (!can('inventory.adjustments.read')) {
    return <Unauthorized />;
  }
  const adjustment = adjustmentQuery.data?.adjustment;
  if (!adjustment) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/stock/ajustes" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Volver a ajustes
        </Link>
        <p className="text-muted-foreground">No se encontró el ajuste.</p>
      </div>
    );
  }

  const canEdit = adjustment.status === 'DRAFT' && can('inventory.adjustments.create');
  const canConfirm = adjustment.status === 'DRAFT' && can('inventory.adjustments.confirm');
  const canCancel = adjustment.status === 'DRAFT' && can('inventory.adjustments.create');

  async function handleConfirm() {
    if (!adjustment) return;
    const summary = adjustment.lines
      .map((l) => `${Number(l.quantityDelta) > 0 ? '+' : ''}${qty(l.quantityDelta)} ${l.productName}`)
      .join('\n');
    const ok = window.confirm(
      `¿Confirmar el ajuste ${adjustment.number}?\n\nSe generarán estos movimientos de inventario y no se podrán deshacer:\n\n${summary}`,
    );
    if (!ok) return;
    setActionError(undefined);
    try {
      await confirmAdjustment.mutateAsync(adjustment.id);
    } catch (err) {
      setActionError(stockErrorMessage(err));
    }
  }

  async function handleCancel() {
    if (!adjustment) return;
    const ok = window.confirm(`¿Cancelar el borrador ${adjustment.number}? No se generó ningún movimiento todavía.`);
    if (!ok) return;
    setActionError(undefined);
    try {
      await cancelAdjustment.mutateAsync(adjustment.id);
      router.push('/stock/ajustes');
    } catch (err) {
      setActionError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/stock/ajustes"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a ajustes
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{adjustment.number}</h1>
          <p className="text-sm text-muted-foreground">
            {adjustment.warehouseName} · {formatDateTime(adjustment.occurredAt)}
          </p>
        </div>
        <span className={`text-sm font-medium ${statusClassName(adjustment.status)}`}>
          {stockAdjustmentStatusLabel(adjustment.status)}
        </span>
      </div>

      {(canEdit || canConfirm || canCancel) && (
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Link href={`/stock/ajustes/${adjustment.id}/editar`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil className="size-4" />
              Editar
            </Link>
          )}
          {canConfirm && (
            <Button type="button" onClick={handleConfirm} disabled={confirmAdjustment.isPending}>
              <Check className="size-4" />
              {confirmAdjustment.isPending ? 'Confirmando…' : 'Confirmar'}
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelAdjustment.isPending}
            >
              <Ban className="size-4" />
              Cancelar borrador
            </Button>
          )}
        </div>
      )}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <div className="rounded-xl border border-border p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Motivo</dt>
            <dd className="mt-0.5">{adjustment.reason}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Creado por</dt>
            <dd className="mt-0.5">{adjustment.createdBy?.name ?? 'Sistema'}</dd>
          </div>
          {adjustment.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notas</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{adjustment.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2 text-right">Cantidad</th>
              <th className="px-4 py-2">Motivo de línea</th>
            </tr>
          </thead>
          <tbody>
            {adjustment.lines.map((line) => {
              const signed = Number(line.quantityDelta);
              return (
                <tr key={line.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    {line.productName}
                    {line.variantName && <p className="text-xs text-muted-foreground">{line.variantName}</p>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{line.sku ?? '—'}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${signed < 0 ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    {signed > 0 ? '+' : ''}
                    {qty(line.quantityDelta)}
                  </td>
                  <td className="px-4 py-2">{line.reason ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
