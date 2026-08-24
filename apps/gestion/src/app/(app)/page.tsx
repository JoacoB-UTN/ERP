'use client';

import Link from 'next/link';
import { ArrowRight, FileText, PackageSearch, Tags, UserPlus, Warehouse } from 'lucide-react';
import { formatMoney, salesDocumentStatusLabel } from '@erp/shared';
import { usePermissions, useDashboardSummary } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { cn } from '@/lib/utils';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

function Stat({ href, label, value, tone }: { href?: string; label: string; value: string; tone?: 'warning' }) {
  const content = (
    <span className="whitespace-nowrap">
      <span className={cn('font-semibold tabular-nums', tone === 'warning' ? 'text-warning' : 'text-foreground')}>
        {value}
      </span>{' '}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
  return href ? (
    <Link href={href} className="rounded-sm hover:underline focus-visible:underline">
      {content}
    </Link>
  ) : (
    content
  );
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
    <div className="flex flex-col gap-2.5">
      <ListHeader title="Inicio" />

      {!hasAnyAccess && (
        <p className="text-sm text-muted-foreground">
          Todavía no tenés acceso a información del panel. Consultá con un administrador si esperabas ver datos
          acá.
        </p>
      )}

      {summaryQuery.isError && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-destructive/25 bg-destructive-muted px-3 py-2">
          <p className="text-sm text-destructive">No pudimos cargar el resumen del panel.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => summaryQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {hasAnyAccess && !summaryQuery.isError && (
        <div
          aria-label="Indicadores operativos"
          className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-md border border-border px-3 py-2 text-sm"
        >
          {loading ? (
            <div className="h-4 w-64 animate-pulse rounded bg-muted" aria-hidden="true" />
          ) : (
            <>
              {summary?.salesToday !== undefined && summary.salesToday !== null && (
                <Stat
                  href="/ventas"
                  label={summary.salesToday.count === 1 ? 'venta confirmada hoy' : 'ventas confirmadas hoy'}
                  value={String(summary.salesToday.count)}
                />
              )}
              {summary?.salesToday !== undefined &&
                summary.salesToday !== null &&
                summary.salesToday.count > 0 &&
                summary.salesToday.totalsByCurrency.map((t) => (
                  <Stat key={t.currencyCode} label="total operado" value={formatMoney(t.total, t.currencyCode)} />
                ))}
              {summary?.openDraftSales !== undefined && summary.openDraftSales !== null && (
                <Stat
                  href="/ventas"
                  label={summary.openDraftSales === 1 ? 'borrador abierto' : 'borradores abiertos'}
                  value={String(summary.openDraftSales)}
                />
              )}
              {summary?.activeCustomers !== undefined && summary.activeCustomers !== null && (
                <Stat href="/clientes" label="clientes activos" value={String(summary.activeCustomers)} />
              )}
              {summary?.activeProducts !== undefined && summary.activeProducts !== null && (
                <Stat href="/productos" label="productos activos" value={String(summary.activeProducts)} />
              )}
              {summary?.belowMinimumStockCount !== undefined &&
                summary.belowMinimumStockCount !== null &&
                summary.belowMinimumStockCount > 0 && (
                  <Stat
                    href="/stock"
                    label="con stock bajo mínimo"
                    value={String(summary.belowMinimumStockCount)}
                    tone="warning"
                  />
                )}
            </>
          )}
        </div>
      )}

      {quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Link key={action.href} href={action.href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <action.icon className="size-3.5" />
              {action.label}
            </Link>
          ))}
        </div>
      )}

      {canReadSales && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">Ventas recientes</h2>
            <Link
              href="/ventas"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
                    <tr key={s.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-1 whitespace-nowrap">
                        <Link href={`/ventas/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                          {s.number}
                        </Link>
                      </td>
                      <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                        {formatDate(s.occurredAt)}
                      </td>
                      <td className="px-3 py-1">{s.customer.legalName}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{formatMoney(s.total, s.currencyCode)}</td>
                      <td className="px-3 py-1">
                        <StatusBadge status={s.status}>{salesDocumentStatusLabel(s.status)}</StatusBadge>
                      </td>
                    </tr>
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
        </div>
      )}
    </div>
  );
}
