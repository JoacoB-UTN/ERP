'use client';

import Link from 'next/link';
import { formatMoney, salesDocumentStatusLabel, type SalesListQuery } from '@erp/shared';
import { useSales } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Shared by the home page (compact, no filters) and /ventas (full list) — see docs/facturacion.md. Uses the same `GET /sales` Gestión's Ventas list uses. */
export function RecentSalesList({
  filters,
  emptyLabel,
}: {
  filters: Partial<SalesListQuery>;
  emptyLabel?: string;
}) {
  const salesQuery = useSales(filters);
  const items = salesQuery.data?.items ?? [];

  if (salesQuery.isError) {
    return (
      <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-center">
        <p className="font-medium">No pudimos cargar las ventas.</p>
        <p className="text-xs text-muted-foreground">Revisá la conexión e intentá nuevamente.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => salesQuery.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!salesQuery.isLoading && items.length === 0) {
    return (
      <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-border bg-card/50 px-4 text-center text-sm text-muted-foreground">
        {emptyLabel ?? 'Todavía no hay ventas.'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[46rem] text-sm">
        <thead className="bg-muted/60 text-left text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="h-9 px-3">Número</th>
            <th className="h-9 px-3">Fecha</th>
            <th className="h-9 px-3">Cliente</th>
            <th className="h-9 px-3 text-right">Total</th>
            <th className="h-9 px-3">Estado</th>
          </tr>
        </thead>
        <tbody>
          {salesQuery.isLoading &&
            Array.from({ length: 6 }).map((_, row) => (
              <tr key={row} className="border-t border-border" aria-hidden="true">
                {Array.from({ length: 5 }).map((__, column) => (
                  <td key={column} className="h-11 px-3">
                    <div className={`h-3 animate-pulse rounded bg-muted ${column === 2 ? 'w-36' : 'w-20'}`} />
                  </td>
                ))}
              </tr>
            ))}
          {items.map((s) => (
            <tr
              key={s.id}
              className="border-t border-border transition-colors hover:bg-muted/40 focus-within:bg-accent/50"
            >
              <td className="h-11 px-3 whitespace-nowrap">
                <Link
                  href={`/ventas/${s.id}`}
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {s.number}
                </Link>
              </td>
              <td className="h-11 px-3 whitespace-nowrap text-muted-foreground">
                {formatDateTime(s.occurredAt)}
              </td>
              <td className="h-11 px-3 font-medium">{s.customer.legalName}</td>
              <td className="h-11 px-3 text-right font-medium tabular-nums">
                {formatMoney(s.total, s.currencyCode)}
              </td>
              <td className="h-11 px-3">
                <StatusBadge status={s.status}>{salesDocumentStatusLabel(s.status)}</StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
