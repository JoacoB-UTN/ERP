'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, PackageSearch, Tags, UserPlus, Warehouse } from 'lucide-react';
import { formatMoney, salesDocumentStatusLabel } from '@erp/shared';
import { usePermissions, useDashboardSummary } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

interface StatCardProps {
  href?: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

function StatCard({ href, label, value, hint }: StatCardProps) {
  const body = (
    <div className="flex min-h-24 flex-col justify-center px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 text-2xl leading-7 font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-[0.6875rem] leading-4 text-muted-foreground">{hint}</div>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block transition-colors hover:bg-muted/45 focus-visible:bg-muted/45">
        {body}
      </Link>
    );
  }
  return body;
}

function StatCardSkeleton() {
  return (
    <div className="flex min-h-24 flex-col justify-center gap-2 px-4 py-3" aria-hidden="true">
      <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      <div className="h-7 w-14 animate-pulse rounded bg-muted" />
    </div>
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
    <div className="flex flex-col gap-5">
      <PageHeader title="Inicio" description="Resumen operativo de la empresa para hoy." />

      {!hasAnyAccess && (
        <p className="max-w-prose text-sm text-muted-foreground">
          Todavía no tenés acceso a información del panel. Consultá con un administrador si esperabas
          ver datos acá.
        </p>
      )}

      {summaryQuery.isError && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-destructive/25 bg-destructive-muted px-4 py-3">
          <p className="text-sm text-destructive">No pudimos cargar el resumen del panel.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => summaryQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {hasAnyAccess && !summaryQuery.isError && (
        <section
          aria-label="Indicadores operativos"
          className="grid overflow-hidden rounded-md border border-border bg-card sm:grid-cols-2 lg:grid-cols-4 [&>*]:border-border [&>*:not(:last-child)]:border-b sm:[&>*]:border-b-0 sm:[&>*:nth-child(odd)]:border-r lg:[&>*:not(:last-child)]:border-r"
        >
          {loading && (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          )}

          {!loading && summary?.salesToday !== undefined && summary.salesToday !== null && (
            <StatCard
              href="/ventas"
              label="Ventas confirmadas hoy"
              value={summary.salesToday.count}
              hint={
                summary.salesToday.count > 0
                  ? summary.salesToday.totalsByCurrency.map((t) => (
                      <div key={t.currencyCode}>Total operado: {formatMoney(t.total, t.currencyCode)}</div>
                    ))
                  : 'Sin ventas confirmadas todavía hoy.'
              }
            />
          )}

          {!loading && summary?.openDraftSales !== undefined && summary.openDraftSales !== null && (
            <StatCard href="/ventas" label="Borradores abiertos" value={summary.openDraftSales} />
          )}

          {!loading && summary?.activeCustomers !== undefined && summary.activeCustomers !== null && (
            <StatCard
              href="/clientes"
              label="Clientes activos"
              value={summary.activeCustomers}
              hint={summary.activeCustomers === 0 ? 'Creá tu primer cliente para empezar.' : undefined}
            />
          )}

          {!loading && summary?.activeProducts !== undefined && summary.activeProducts !== null && (
            <StatCard
              href="/productos"
              label="Productos activos"
              value={summary.activeProducts}
              hint={
                summary.activeProducts === 0
                  ? 'Agregá productos y precios para comenzar a vender.'
                  : undefined
              }
            />
          )}

          {!loading &&
            summary?.belowMinimumStockCount !== undefined &&
            summary.belowMinimumStockCount !== null &&
            summary.belowMinimumStockCount > 0 && (
              <StatCard
                href="/stock"
                label="Stock a revisar"
                value={summary.belowMinimumStockCount}
                hint="Por debajo del mínimo definido."
              />
            )}
        </section>
      )}

      {quickActions.length > 0 && (
        <section className="flex flex-col gap-2 border-y border-border bg-card/60 py-3 sm:flex-row sm:items-center">
          <h2 className="mr-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Acciones rápidas</h2>
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
        </section>
      )}

      {canReadSales && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Ventas recientes</h2>
            <Link
              href="/ventas"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Ver todas
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Número</th>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Cliente</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {loading && <TableRowsSkeleton columns={5} rows={4} />}
                {!loading &&
                  summary?.recentSales?.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Link
                          href={`/ventas/${s.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {s.number}
                        </Link>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                        {formatDate(s.occurredAt)}
                      </td>
                      <td className="px-4 py-2">{s.customer.legalName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(s.total, s.currencyCode)}
                      </td>
                      <td className="px-4 py-2">
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
