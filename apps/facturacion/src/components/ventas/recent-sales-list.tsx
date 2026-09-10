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
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[46rem] text-sm">
        <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5">Número</th>
            <th className="px-3 py-1.5">Fecha</th>
            <th className="px-3 py-1.5">Cliente</th>
            <th className="px-3 py-1.5 text-right">Total</th>
            <th className="px-3 py-1.5">Estado</th>
          </tr>
        </thead>
        <tbody>
          {salesQuery.isLoading &&
            Array.from({ length: 6 }).map((_, row) => (
              <tr key={row} className="border-t border-border" aria-hidden="true">
                {Array.from({ length: 5 }).map((__, column) => (
                  <td key={column} className="px-3 py-1">
                    <div className={`h-3 animate-pulse rounded bg-muted ${column === 2 ? 'w-36' : 'w-20'}`} />
                  </td>
                ))}
              </tr>
            ))}
          {items.map((s) => (
            <tr
              key={s.id}
              className="border-t border-border hover:bg-muted/30"
            >
              <td className="px-3 py-1 whitespace-nowrap">
                <Link
                  href={`/ventas/${s.id}`}
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {s.number}
                </Link>
              </td>
              <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                {formatDateTime(s.occurredAt)}
              </td>
              <td className="px-3 py-1">{s.customer.legalName}</td>
              <td className="px-3 py-1 text-right tabular-nums">
                {formatMoney(s.total, s.currencyCode)}
              </td>
              <td className="px-3 py-1">
                <StatusBadge status={s.status}>{salesDocumentStatusLabel(s.status)}</StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
