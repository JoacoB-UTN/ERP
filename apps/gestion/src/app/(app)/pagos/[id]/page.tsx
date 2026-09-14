'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@erp/auth-client';
import { supplierPaymentStatusLabel, formatMoney, salesTenderMethodLabel } from '@erp/shared';

import {
  usePermissions,
  useSupplierPayment,
  useConfirmSupplierPayment,
  useCancelSupplierPayment,
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

export default function PagoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, isLoading: permissionsLoading } = usePermissions();
  const paymentQuery = useSupplierPayment(id);
  const confirmPayment = useConfirmSupplierPayment();
  const cancelPayment = useCancelSupplierPayment();
  const [error, setError] = useState<string | null>(null);

  if (permissionsLoading) {
    return null;
  }
  if (!can('treasury.payments.read')) {
    return <Unauthorized />;
  }

  const payment = paymentQuery.data?.payment;
  if (!payment) {
    return paymentQuery.isLoading ? null : (
      <p className="text-sm text-muted-foreground">No encontramos el pago.</p>
    );
  }

  const isDraft = payment.status === 'DRAFT';
  const isConfirmed = payment.status === 'CONFIRMED';
  const busy = confirmPayment.isPending || cancelPayment.isPending;

  async function handleConfirm() {
    setError(null);
    try {
      await confirmPayment.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo confirmar el pago.');
    }
  }

  async function handleCancel() {
    if (!window.confirm('¿Anular este pago? Se registra un movimiento de reversión en la cuenta.')) {
      return;
    }
    setError(null);
    try {
      await cancelPayment.mutateAsync({ id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular el pago.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Pago {payment.number}
            <StatusBadge status={payment.status}>
              {supplierPaymentStatusLabel(payment.status)}
            </StatusBadge>
          </span>
        }
        description={`${payment.supplier.code} · ${payment.supplier.legalName}`}
        backHref="/pagos"
        backLabel="Pagos"
        actions={
          <>
            {isDraft && can('treasury.payments.confirm') && (
              <Button type="button" onClick={handleConfirm} disabled={busy}>
                {confirmPayment.isPending ? 'Confirmando…' : 'Confirmar'}
              </Button>
            )}
            {/* A CONFIRMED collection can still be cancelled — unlike a sale,
                that is not a terminal state here; cancelling posts a
                compensating reversal rather than erasing history (see
                docs/current-accounts.md). */}
            {(isDraft || isConfirmed) && can('treasury.payments.cancel') && (
              <Button type="button" variant="outline" onClick={handleCancel} disabled={busy}>
                {cancelPayment.isPending ? 'Anulando…' : 'Anular'}
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
        <Field label="Fecha" value={formatDate(payment.occurredAt)} />
        <Field label="Medio de pago" value={salesTenderMethodLabel(payment.paymentMethod)} />
        <Field label="Referencia" value={payment.externalReference ?? '—'} />
        <Field label="Importe" value={formatMoney(payment.amount, payment.currencyCode)} />
        <Field
          label="Aplicado"
          value={formatMoney(payment.appliedAmount, payment.currencyCode)}
        />
        <Field
          label="Sin aplicar"
          value={formatMoney(payment.unappliedAmount, payment.currencyCode)}
        />
      </div>

      {payment.notes && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Notas</div>
          <p className="mt-1 text-sm whitespace-pre-wrap">{payment.notes}</p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">Recepciones aplicadas</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5">Recepción</th>
                <th className="px-3 py-1.5 text-right">Importe aplicado</th>
              </tr>
            </thead>
            <tbody>
              {payment.applications.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-1 whitespace-nowrap">
                    <Link
                      href={`/compras/recepciones/${a.purchaseReceiptId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {a.purchaseReceiptNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {formatMoney(a.amount, payment.currencyCode)}
                  </td>
                </tr>
              ))}
              {payment.applications.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                    Este pago no se aplicó a ninguna recepción; queda como saldo a favor nuestro con el proveedor.
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
          value={`${formatDate(payment.createdAt)}${payment.createdBy?.name ? ` · ${payment.createdBy.name}` : ''}`}
        />
        <Field
          label="Confirmado"
          value={
            payment.confirmedAt
              ? `${formatDate(payment.confirmedAt)}${payment.confirmedBy?.name ? ` · ${payment.confirmedBy.name}` : ''}`
              : '—'
          }
        />
        <Field
          label="Anulado"
          value={
            payment.cancelledAt
              ? `${formatDate(payment.cancelledAt)}${payment.cancelledBy?.name ? ` · ${payment.cancelledBy.name}` : ''}`
              : '—'
          }
        />
      </div>
    </div>
  );
}
