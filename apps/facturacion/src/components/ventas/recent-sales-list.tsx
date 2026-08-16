'use client';

import Link from 'next/link';
import { formatMoney, salesDocumentStatusLabel, type SalesListQuery } from '@erp/shared';
import { useSales } from '@/lib/auth-client';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusClassName(status: string): string {
  if (status === 'CONFIRMED') return 'text-emerald-600';
  if (status === 'CANCELLED') return 'text-muted-foreground';
  return 'text-amber-600';
}

/** Shared by the home page (compact, no filters) and /ventas (full list) — see docs/facturacion.md. Uses the same `GET /sales` Gestión's Ventas list uses. */
export function RecentSalesList({ filters, emptyLabel }: { filters: Partial<SalesListQuery>; emptyLabel?: string }) {
  const salesQuery = useSales(filters);
  const items = salesQuery.data?.items ?? [];

  if (!salesQuery.isLoading && items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel ?? 'Todavía no hay ventas.'}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Número</th>
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-t border-border">
              <td className="px-3 py-2 whitespace-nowrap">
                <Link href={`/ventas/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                  {s.number}
                </Link>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(s.occurredAt)}</td>
              <td className="px-3 py-2">{s.customer.legalName}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.total, s.currencyCode)}</td>
              <td className={`px-3 py-2 ${statusClassName(s.status)}`}>{salesDocumentStatusLabel(s.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
