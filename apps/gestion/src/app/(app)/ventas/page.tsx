'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatMoney, salesDocumentStatusLabel, type SalesListQuery } from '@erp/shared';
import { usePermissions, useSales, useWarehouses } from '@/lib/auth-client';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Unauthorized } from '@/components/layout/unauthorized';

const PAGE_SIZE = 25;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

export default function VentasPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();

  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const salesQuery = useSales({
    search: search.trim() || undefined,
    warehouseId: warehouseId || undefined,
    status: (status || undefined) as SalesListQuery['status'],
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('sales.documents.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('sales.documents.create');
  const items = salesQuery.data?.items ?? [];
  const pagination = salesQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const hasActiveFilters = !!(search.trim() || warehouseId || status);

  function clearFilters() {
    setSearch('');
    setWarehouseId('');
    setStatus('');
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-lg leading-6 font-semibold tracking-tight">Ventas</h1>
          {pagination && (
            <span className="text-xs text-muted-foreground">
              {pagination.total} {pagination.total === 1 ? 'venta' : 'ventas'}
            </span>
          )}
        </div>
        {canCreate && (
          <Link href="/ventas/nueva" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Nueva venta
          </Link>
        )}
      </div>

      <div role="search" className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por número o cliente…"
          className="h-8 max-w-64 py-1 text-sm"
          aria-label="Buscar"
        />
        <Select
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value);
            setPage(1);
          }}
          className="h-8 max-w-44 py-1 text-sm"
          aria-label="Depósito"
        >
          <option value="">Todos los depósitos</option>
          {warehousesQuery.data?.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-8 max-w-36 py-1 text-sm"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borrador</option>
          <option value="CONFIRMED">Confirmada</option>
          <option value="CANCELLED">Cancelada</option>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Número</th>
              <th className="px-3 py-1.5">Fecha</th>
              <th className="px-3 py-1.5">Cliente</th>
              <th className="px-3 py-1.5">Depósito</th>
              <th className="px-3 py-1.5">Lista</th>
              <th className="px-3 py-1.5 text-right">Total</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {salesQuery.isLoading && <TableRowsSkeleton columns={7} />}
            {items.map((s) => (
              <tr key={s.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1 whitespace-nowrap">
                  <Link href={`/ventas/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                    {s.number}
                  </Link>
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{formatDate(s.occurredAt)}</td>
                <td className="px-3 py-1">{s.customer.legalName}</td>
                <td className="px-3 py-1 whitespace-nowrap">{s.warehouse.name}</td>
                <td className="px-3 py-1 whitespace-nowrap">{s.priceList.name}</td>
                <td className="px-3 py-1 text-right tabular-nums">{formatMoney(s.total, s.currencyCode)}</td>
                <td className="px-3 py-1">
                  <StatusBadge status={s.status}>{salesDocumentStatusLabel(s.status)}</StatusBadge>
                </td>
              </tr>
            ))}
            {salesQuery.isError && (
              <TableMessage
                columns={7}
                kind="error"
                title="No pudimos cargar las ventas"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => salesQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!salesQuery.isLoading && !salesQuery.isError && items.length === 0 && !hasActiveFilters && (
              <TableMessage
                columns={7}
                title="Todavía no hay ventas registradas"
                description="Creá un borrador para comenzar el flujo comercial."
                action={canCreate && (
                  <Link href="/ventas/nueva" className={buttonVariants()}>
                    <Plus className="size-4" />
                    Nueva venta
                  </Link>
                )}
              />
            )}
            {!salesQuery.isLoading && !salesQuery.isError && items.length === 0 && hasActiveFilters && (
              <TableMessage
                columns={7}
                kind="filtered"
                title="No encontramos ventas"
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
          itemLabel={pagination.total === 1 ? 'venta' : 'ventas'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
