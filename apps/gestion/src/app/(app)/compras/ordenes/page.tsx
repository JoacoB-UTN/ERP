'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatMoney, purchaseOrderStatusLabel, PurchaseOrderStatus } from '@erp/shared';
import { usePermissions, usePurchaseOrders } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button, buttonVariants } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';

const PAGE_SIZE = 25;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

export default function OrdenesDeCompraPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const ordersQuery = usePurchaseOrders({
    search: search || undefined,
    status: (status || undefined) as PurchaseOrderStatus | undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('purchases.orders.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('purchases.orders.create');
  const items = ordersQuery.data?.items ?? [];
  const pagination = ordersQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const hasActiveFilters = !!(search || status);

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Órdenes de compra"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'orden' : 'órdenes'}`}
        actions={canCreate && (
          <Link href="/compras/ordenes/nueva" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Nueva orden de compra
          </Link>
        )}
      />

      <Toolbar>
        <Input
          placeholder="Buscar por número o proveedor…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-8 max-w-sm py-1 text-sm"
          aria-label="Buscar órdenes de compra"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-8 max-w-40 py-1 text-sm"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          {Object.values(PurchaseOrderStatus).map((value) => (
            <option key={value} value={value}>
              {purchaseOrderStatusLabel(value)}
            </option>
          ))}
        </Select>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Número</th>
              <th className="px-3 py-1.5">Fecha</th>
              <th className="px-3 py-1.5">Proveedor</th>
              <th className="px-3 py-1.5 text-right">Total</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {ordersQuery.isLoading && <TableRowsSkeleton columns={5} />}
            {items.map((order) => (
              <tr key={order.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1 whitespace-nowrap">
                  <Link
                    href={`/compras/ordenes/${order.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {order.number}
                  </Link>
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{formatDate(order.orderDate)}</td>
                <td className="px-3 py-1">{order.supplier.legalName}</td>
                <td className="px-3 py-1 text-right tabular-nums">{formatMoney(order.total, order.currencyCode)}</td>
                <td className="px-3 py-1">
                  <StatusBadge status={order.status}>{purchaseOrderStatusLabel(order.status)}</StatusBadge>
                </td>
              </tr>
            ))}
            {ordersQuery.isError && (
              <TableMessage
                columns={5}
                kind="error"
                title="No pudimos cargar las órdenes de compra"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => ordersQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!ordersQuery.isLoading && !ordersQuery.isError && items.length === 0 && !hasActiveFilters && (
              <TableMessage
                columns={5}
                title="Todavía no hay órdenes de compra"
                description="Creá una orden para empezar a comprometer mercadería con un proveedor."
                action={canCreate && (
                  <Link href="/compras/ordenes/nueva" className={`${buttonVariants()} mt-4`}>
                    <Plus className="size-4" />
                    Nueva orden de compra
                  </Link>
                )}
              />
            )}
            {!ordersQuery.isLoading && !ordersQuery.isError && items.length === 0 && hasActiveFilters && (
              <TableMessage
                columns={5}
                kind="filtered"
                title="No encontramos órdenes de compra"
                description="Probá con otros criterios o limpiá los filtros."
                action={
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                }
              />
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <Pagination
          page={pagination.page}
          totalPages={totalPages}
          total={pagination.total}
          itemLabel={pagination.total === 1 ? 'orden' : 'órdenes'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
