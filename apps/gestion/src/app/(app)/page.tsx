'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, PackageSearch, Tags, UserPlus, Warehouse } from 'lucide-react';
import { formatMoney, salesDocumentStatusLabel } from '@erp/shared';
import { usePermissions, useDashboardSummary } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

function statusClassName(status: string): string {
  if (status === 'CONFIRMED') return 'text-emerald-600';
  if (status === 'CANCELLED') return 'text-muted-foreground';
  return 'text-amber-600';
}

interface StatCardProps {
  href?: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

function StatCard({ href, label, value, hint }: StatCardProps) {
  const body = (
    <>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </>
  );

  if (href) {
    return (
      <Card size="sm" className="p-0 transition-colors hover:bg-muted/40">
        <Link href={href} className="flex flex-col gap-(--card-spacing) py-(--card-spacing)">
          {body}
        </Link>
      </Card>
    );
  }
  return <Card size="sm">{body}</Card>;
}

function StatCardSkeleton() {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-7 w-14 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inicio</h1>
        <p className="text-sm text-muted-foreground">Resumen de la actividad comercial de hoy.</p>
      </div>

      {!hasAnyAccess && (
        <p className="max-w-prose text-sm text-muted-foreground">
          Todavía no tenés acceso a información del panel. Consultá con un administrador si esperabas
          ver datos acá.
        </p>
      )}

      {summaryQuery.isError && (
        <Card size="sm" className="border-destructive/30">
          <CardContent className="flex items-center justify-between gap-4 py-1">
            <p className="text-sm text-muted-foreground">No pudimos cargar el resumen del panel.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => summaryQuery.refetch()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      )}

      {hasAnyAccess && !summaryQuery.isError && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
        </div>
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

          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
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
                {loading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-4 py-3" colSpan={5}>
                        <div className="h-4 w-full max-w-64 animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))}
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
                      <td className={cn('px-4 py-2', statusClassName(s.status))}>
                        {salesDocumentStatusLabel(s.status)}
                      </td>
                    </tr>
                  ))}
                {!loading && summary?.recentSales?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No hay ventas confirmadas todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {quickActions.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Acciones rápidas</h2>
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <Link key={action.href} href={action.href} className={buttonVariants({ variant: 'outline' })}>
                <action.icon className="size-4" />
                {action.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
