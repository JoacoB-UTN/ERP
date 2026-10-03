'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { ApiError } from '@erp/auth-client';
import type { TreasuryMovementType, TreasuryTransferStatus } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { useActiveCompany, authClient } from '@/lib/auth-client';

export const movementLabels: Record<TreasuryMovementType, string> = {
  OPENING_BALANCE: 'Saldo inicial',
  COLLECTION: 'Cobro',
  COLLECTION_REVERSAL: 'Anulación de cobro',
  PAYMENT: 'Pago',
  PAYMENT_REVERSAL: 'Anulación de pago',
  TRANSFER_IN: 'Transferencia recibida',
  TRANSFER_OUT: 'Transferencia enviada',
  TRANSFER_IN_REVERSAL: 'Anulación de transferencia recibida',
  TRANSFER_OUT_REVERSAL: 'Anulación de transferencia enviada',
  ADJUSTMENT: 'Ajuste',
};
export function sourceLabel(sourceType: string) {
  const labels: Record<string, string> = {
    TreasuryAccount: 'Cuenta',
    TreasuryTransfer: 'Transferencia',
    CustomerCollection: 'Cobro',
    SupplierPayment: 'Pago',
    OPENING_BALANCE: 'Apertura',
    TREASURY_ACCOUNT: 'Cuenta',
    TREASURY_TRANSFER: 'Transferencia',
    CUSTOMER_COLLECTION: 'Cobro',
    SUPPLIER_PAYMENT: 'Pago',
    COLLECTION: 'Cobro',
    PAYMENT: 'Pago',
    TRANSFER: 'Transferencia',
    ADJUSTMENT: 'Ajuste',
  };
  return labels[sourceType] ?? 'Comprobante de origen';
}
export const statusLabels: Record<TreasuryTransferStatus, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Anulada',
};

// Presentation only: never parse money through Number or round away stored precision.
export function money(amount: string, currency: string) {
  const [integer, fraction] = amount.split('.');
  return `${currency} ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction ? `,${fraction}` : ''}`;
}
export function localDateBound(value: string, end = false): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}
export function dateTime(value: string) {
  return new Date(value).toLocaleString('es-AR');
}
export function dateTimeInput(value: string) {
  const date = new Date(value);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'No se pudo completar la operación. Volvé a intentar.';
}
export function ErrorNotice({ error }: { error?: unknown }) {
  return error ? (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {typeof error === 'string' ? error : errorMessage(error)}
    </p>
  ) : null;
}
export function QueryState({
  query,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
}) {
  if (query.isPending) return <p role="status">Cargando…</p>;
  if (query.isError)
    return (
      <div className="space-y-2">
        <ErrorNotice error={query.error} />
        <Button variant="outline" onClick={() => void query.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  return null;
}
export function PosNotice() {
  return (
    <p className="text-sm text-muted-foreground">
      Este saldo no incluye ventas de POS ni cobros y pagos históricos sin cuenta asignada.
    </p>
  );
}
export function TreasuryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="font-medium text-primary underline-offset-4 hover:underline" href={href}>
      {children}
    </Link>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
export const tableClass =
  'w-full text-left text-sm [&_th]:px-4 [&_th]:py-3 [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-4 [&_td]:py-3 [&_tbody_tr]:border-t';
export function Pager({
  page,
  pageSize = 25,
  total,
  onPage,
  busy,
}: {
  page: number;
  pageSize?: number;
  total: number;
  onPage: (page: number) => void;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Button variant="outline" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
        Anterior
      </Button>
      <span>
        Página {page} · {total} registros
      </span>
      <Button variant="outline" disabled={page * pageSize >= total || busy} onClick={() => onPage(page + 1)}>
        Siguiente
      </Button>
    </div>
  );
}
// Async completion must not navigate a new company's screen to the old result.
export function useStillInCompany() {
  const { activeCompanyId } = useActiveCompany();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => mounted.current && authClient.companyContextStore.getActiveCompanyId() === activeCompanyId;
}
