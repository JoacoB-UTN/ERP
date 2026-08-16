'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { formatDecimalDisplay, movementTypeLabel } from '@erp/shared';
import { usePermissions, useMovement } from '@/lib/auth-client';
import { Unauthorized } from '@/components/layout/unauthorized';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'medium' });
}

function qty(value: string): string {
  return formatDecimalDisplay(value, 6) ?? value;
}

/**
 * Read-only — StockMovement is immutable, so there is no edit affordance
 * here or anywhere else (see CLAUDE.md and docs/inventory.md).
 */
export default function MovimientoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const movementQuery = useMovement(id ?? null);

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.movements.read')) {
    return <Unauthorized />;
  }
  if (movementQuery.isLoading) {
    return null;
  }
  const movement = movementQuery.data?.movement;
  if (!movement) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/stock/movimientos" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Volver a movimientos
        </Link>
        <p className="text-muted-foreground">No se encontró el movimiento.</p>
      </div>
    );
  }

  const signed = Number(movement.quantity);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/stock/movimientos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a movimientos
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{movementTypeLabel(movement.movementType)}</h1>
        <p className="text-sm text-muted-foreground">{formatDateTime(movement.occurredAt)}</p>
      </div>

      <div className="rounded-xl border border-border p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Producto</dt>
            <dd className="mt-0.5">
              <Link href={`/productos/${movement.productId}`} className="underline-offset-4 hover:underline">
                {movement.productName}
              </Link>
              {(movement.variantName || movement.sku) && (
                <p className="text-sm text-muted-foreground">
                  {movement.variantName}
                  {movement.variantName && movement.sku ? ' · ' : ''}
                  {movement.sku}
                </p>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Depósito</dt>
            <dd className="mt-0.5">
              {movement.warehouse.name} ({movement.warehouse.code})
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Cantidad</dt>
            <dd className={`mt-0.5 tabular-nums ${signed < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {signed > 0 ? '+' : ''}
              {qty(movement.quantity)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Usuario</dt>
            <dd className="mt-0.5">{movement.createdBy?.name ?? 'Sistema'}</dd>
          </div>
          {movement.referenceType && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Referencia</dt>
              <dd className="mt-0.5">
                {movement.referenceType}
                {movement.referenceId ? ` #${movement.referenceId}` : ''}
              </dd>
            </div>
          )}
          {movement.reason && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Motivo</dt>
              <dd className="mt-0.5">{movement.reason}</dd>
            </div>
          )}
          {movement.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notas</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{movement.notes}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
