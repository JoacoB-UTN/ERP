'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Pencil, Check, Ban } from 'lucide-react';
import { formatDecimalDisplay, stockTransferStatusLabel } from '@erp/shared';
import {
  usePermissions,
  useStockTransfer,
  useConfirmStockTransfer,
  useCancelStockTransfer,
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

export default function TransferenciaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const transferQuery = useStockTransfer(id ?? null);
  const confirmTransfer = useConfirmStockTransfer();
  const cancelTransfer = useCancelStockTransfer();
  const [actionError, setActionError] = useState<string | undefined>();

  if (permissionsLoading || transferQuery.isLoading) {
    return null;
  }
  if (!can('inventory.transfers.read')) {
    return <Unauthorized />;
  }
  const transfer = transferQuery.data?.transfer;
  if (!transfer) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/stock/transferencias"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver a transferencias
        </Link>
        <p className="text-muted-foreground">No se encontró la transferencia.</p>
      </div>
    );
  }

  const isDraft = transfer.status === 'DRAFT';
  const canEdit = isDraft && can('inventory.transfers.create');
  const canConfirm = isDraft && can('inventory.transfers.confirm');
  // A draft cancellation touches no stock; cancelling a CONFIRMED transfer
  // writes compensating movements. Same permission, deliberately different
  // confirmation copy below — see docs/inventory.md.
  const canCancel =
    (isDraft || transfer.status === 'CONFIRMED') && can('inventory.transfers.cancel');

  async function handleConfirm() {
    if (!transfer) return;
    const summary = transfer.lines
      .map((l) => `${qty(l.quantity)} × ${l.productName}`)
      .join('\n');
    const ok = window.confirm(
      `¿Confirmar la transferencia ${transfer.number}?\n\n` +
        `Sale de: ${transfer.sourceWarehouseName}\n` +
        `Entra en: ${transfer.destinationWarehouseName}\n\n${summary}`,
    );
    if (!ok) return;
    setActionError(undefined);
    try {
      await confirmTransfer.mutateAsync(transfer.id);
    } catch (err) {
      setActionError(stockErrorMessage(err));
    }
  }

  async function handleCancel() {
    if (!transfer) return;
    const wasConfirmed = transfer.status === 'CONFIRMED';
    const ok = window.confirm(
      wasConfirmed
        ? `¿Anular la transferencia ${transfer.number}?\n\nSe generarán movimientos compensatorios que devuelven el stock a ${transfer.sourceWarehouseName}. Los movimientos originales no se modifican.`
        : `¿Anular el borrador ${transfer.number}? No se generó ningún movimiento todavía.`,
    );
    if (!ok) return;
    setActionError(undefined);
    try {
      await cancelTransfer.mutateAsync(transfer.id);
      // A cancelled draft has nothing left to show; a cancelled confirmed
      // transfer keeps its ledger history, so stay and let it be read.
      if (!wasConfirmed) router.push('/stock/transferencias');
    } catch (err) {
      setActionError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Link
        href="/stock/transferencias"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a transferencias
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{transfer.number}</h1>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {transfer.sourceWarehouseName}
            <ArrowRight className="size-3.5 shrink-0" aria-label="hacia" />
            {transfer.destinationWarehouseName}
            <span aria-hidden>·</span>
            {formatDateTime(transfer.occurredAt)}
          </p>
        </div>
        <span className={`text-sm font-medium ${statusClassName(transfer.status)}`}>
          {stockTransferStatusLabel(transfer.status)}
        </span>
      </div>

      {(canEdit || canConfirm || canCancel) && (
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Link
              href={`/stock/transferencias/${transfer.id}/editar`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Pencil className="size-4" />
              Editar
            </Link>
          )}
          {canConfirm && (
            <Button type="button" onClick={handleConfirm} disabled={confirmTransfer.isPending}>
              <Check className="size-4" />
              {confirmTransfer.isPending ? 'Confirmando…' : 'Confirmar'}
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelTransfer.isPending}
            >
              <Ban className="size-4" />
              {isDraft ? 'Anular borrador' : 'Anular transferencia'}
            </Button>
          )}
        </div>
      )}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <div className="rounded-xl border border-border p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Motivo</dt>
            <dd className="mt-0.5">{transfer.reason ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Creada por</dt>
            <dd className="mt-0.5">{transfer.createdBy?.name ?? 'Sistema'}</dd>
          </div>
          {transfer.confirmedAt && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Confirmada</dt>
              <dd className="mt-0.5">{formatDateTime(transfer.confirmedAt)}</dd>
            </div>
          )}
          {transfer.cancelledAt && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Anulada</dt>
              <dd className="mt-0.5">{formatDateTime(transfer.cancelledAt)}</dd>
            </div>
          )}
          {transfer.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notas</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{transfer.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Producto</th>
              <th className="px-3 py-1.5">SKU</th>
              <th className="px-3 py-1.5 text-right">Cantidad</th>
              <th className="px-3 py-1.5">Nota de línea</th>
            </tr>
          </thead>
          <tbody>
            {transfer.lines.map((line) => (
              <tr key={line.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1">
                  {line.productName}
                  {line.variantName && (
                    <p className="text-xs text-muted-foreground">{line.variantName}</p>
                  )}
                </td>
                <td className="px-3 py-1 whitespace-nowrap">{line.sku ?? '—'}</td>
                <td className="px-3 py-1 text-right tabular-nums">{qty(line.quantity)}</td>
                <td className="px-3 py-1">{line.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
