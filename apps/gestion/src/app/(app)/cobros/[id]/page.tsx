'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@erp/auth-client';
import { customerCollectionStatusLabel, formatMoney, salesTenderMethodLabel } from '@erp/shared';

import {
  usePermissions,
  useCustomerCollection,
  useConfirmCustomerCollection,
  useCancelCustomerCollection,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Unauthorized } from '@/components/layout/unauthorized';

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' }) : '—';
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export default function CobroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, isLoading: permissionsLoading } = usePermissions();
  const collectionQuery = useCustomerCollection(id);
  const confirmCollection = useConfirmCustomerCollection();
  const cancelCollection = useCancelCustomerCollection();
  const [error, setError] = useState<string | null>(null);

  if (permissionsLoading) {
    return null;
  }
  if (!can('treasury.receipts.read')) {
    return <Unauthorized />;
  }

  const collection = collectionQuery.data?.collection;
  if (!collection) {
    return collectionQuery.isLoading ? null : (
      <p className="text-sm text-muted-foreground">No encontramos el cobro.</p>
    );
  }

  const isDraft = collection.status === 'DRAFT';
  const isConfirmed = collection.status === 'CONFIRMED';
  const busy = confirmCollection.isPending || cancelCollection.isPending;

  async function handleConfirm() {
    setError(null);
    try {
      await confirmCollection.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo confirmar el cobro.');
    }
  }

  async function handleCancel() {
    if (!window.confirm('¿Anular este cobro? Se registra un movimiento de reversión en la cuenta.')) {
      return;
    }
    setError(null);
    try {
      await cancelCollection.mutateAsync({ id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular el cobro.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Cobro {collection.number}
            <StatusBadge status={collection.status}>
              {customerCollectionStatusLabel(collection.status)}
            </StatusBadge>
          </span>
        }
        description={`${collection.customer.code} · ${collection.customer.legalName}`}
        backHref="/cobros"
        backLabel="Cobros"
        actions={
          <>
            {isDraft && can('treasury.receipts.confirm') && (
              <Button type="button" onClick={handleConfirm} disabled={busy}>
                {confirmCollection.isPending ? 'Confirmando…' : 'Confirmar'}
              </Button>
            )}
            {/* A CONFIRMED collection can still be cancelled — unlike a sale,
                that is not a terminal state here; cancelling posts a
                compensating reversal rather than erasing history (see
                docs/current-accounts.md). */}
            {(isDraft || isConfirmed) && can('treasury.receipts.cancel') && (
              <Button type="button" variant="outline" onClick={handleCancel} disabled={busy}>
                {cancelCollection.isPending ? 'Anulando…' : 'Anular'}
              </Button>
            )}
          </>
        }
      />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
        <Field label="Fecha" value={formatDate(collection.occurredAt)} />
        <Field label="Medio de pago" value={salesTenderMethodLabel(collection.paymentMethod)} />
        <Field label="Referencia" value={collection.externalReference ?? '—'} />
        <Field label="Importe" value={formatMoney(collection.amount, collection.currencyCode)} />
        <Field
          label="Aplicado"
          value={formatMoney(collection.appliedAmount, collection.currencyCode)}
        />
        <Field
          label="Sin aplicar"
          value={formatMoney(collection.unappliedAmount, collection.currencyCode)}
        />
      </div>

      {collection.notes && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Notas</div>
          <p className="mt-1 text-sm whitespace-pre-wrap">{collection.notes}</p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">Ventas aplicadas</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5">Venta</th>
                <th className="px-3 py-1.5 text-right">Importe aplicado</th>
              </tr>
            </thead>
            <tbody>
              {collection.applications.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-1 whitespace-nowrap">
                    <Link
                      href={`/ventas/${a.salesDocumentId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {a.salesDocumentNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {formatMoney(a.amount, collection.currencyCode)}
                  </td>
                </tr>
              ))}
              {collection.applications.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                    Este cobro no se aplicó a ninguna venta; queda como saldo a favor del cliente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 text-xs sm:grid-cols-3">
        <Field
          label="Creado"
          value={`${formatDate(collection.createdAt)}${collection.createdBy?.name ? ` · ${collection.createdBy.name}` : ''}`}
        />
        <Field
          label="Confirmado"
          value={
            collection.confirmedAt
              ? `${formatDate(collection.confirmedAt)}${collection.confirmedBy?.name ? ` · ${collection.confirmedBy.name}` : ''}`
              : '—'
          }
        />
        <Field
          label="Anulado"
          value={
            collection.cancelledAt
              ? `${formatDate(collection.cancelledAt)}${collection.cancelledBy?.name ? ` · ${collection.cancelledBy.name}` : ''}`
              : '—'
          }
        />
      </div>
    </div>
  );
}
