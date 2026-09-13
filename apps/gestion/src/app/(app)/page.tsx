'use client';

import Link from 'next/link';
import { ArrowRight, FileText, PackageSearch, Tags, UserPlus, Warehouse } from 'lucide-react';
import { formatMoney, salesDocumentStatusLabel } from '@erp/shared';
import { usePermissions, useDashboardSummary } from '@/lib/auth-client';
import { SalesOverview } from '@/components/dashboard/sales-overview';
import { Button, buttonVariants } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { LinkedRow, RowLink, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

export default function DashboardPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const summaryQuery = useDashboardSummary();

  if (permissionsLoading) {
    return null;
  }

  const summary = summaryQuery.data;
  const loading = summaryQuery.isLoading;

  const canReadSales = can('sales.documents.read');
  const canReadCustomers = can('customers.read');
  const canReadProducts = can('products.read');
  const canReadStock = can('inventory.stock.read');

  const quickActions = [
    {
      href: '/ventas/nueva',
      label: 'Nueva venta',
      icon: FileText,
      visible: can('sales.documents.create'),
    },
    {
      href: '/clientes/nuevo',
      label: 'Nuevo cliente',
      icon: UserPlus,
      visible: can('customers.create'),
    },
    {
      href: '/productos/nuevo',
      label: 'Nuevo producto',
      icon: PackageSearch,
      visible: can('products.create'),
    },
    {
      href: '/stock/ajustes/nuevo',
      label: 'Ajustar stock',
      icon: Warehouse,
      visible: can('inventory.adjustments.create'),
    },
    {
      href: '/listas-de-precios',
      label: 'Listas de precios',
      icon: Tags,
      visible: can('pricing.lists.read'),
    },
  ].filter((action) => action.visible);

  const hasAnyAccess = canReadSales || canReadCustomers || canReadProducts || canReadStock;

  return (
    <div className="flex flex-col gap-4">
      <ListHeader title="Inicio" />

      {!hasAnyAccess && (
        <p className="text-sm text-muted-foreground">
          Todavía no tenés acceso a información del panel. Consultá con un administrador si esperabas ver
          datos acá.
        </p>
      )}

      {quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <action.icon className="size-3.5" />
              {action.label}
            </Link>
          ))}
        </div>
      )}

      {canReadSales && <SalesOverview />}

      {summaryQuery.isError && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive-muted px-4 py-3">
          <p className="text-sm text-destructive">No pudimos cargar las ventas recientes.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => summaryQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {canReadSales && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Ventas recientes</h2>
            <Link
              href="/ventas"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Ver todas
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
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
                {loading && <TableRowsSkeleton columns={5} rows={4} />}
                {!loading &&
                  summary?.recentSales?.map((s) => (
                    <LinkedRow key={s.id}>
                      <td className="px-3 py-1 whitespace-nowrap">
                        <RowLink href={`/ventas/${s.id}`}>{s.number}</RowLink>
                      </td>
                      <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                        {formatDate(s.occurredAt)}
                      </td>
                      <td className="px-3 py-1">{s.customer.legalName}</td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        {formatMoney(s.total, s.currencyCode)}
                      </td>
                      <td className="px-3 py-1">
                        <StatusBadge status={s.status}>{salesDocumentStatusLabel(s.status)}</StatusBadge>
                      </td>
                    </LinkedRow>
                  ))}
                {!loading && summary?.recentSales?.length === 0 && (
                  <TableMessage
                    columns={5}
                    title="No hay ventas confirmadas todavía"
                    description="Las ventas confirmadas aparecerán acá como referencia rápida."
                  />
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
