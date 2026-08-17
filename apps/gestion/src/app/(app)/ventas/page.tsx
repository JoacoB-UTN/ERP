'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatMoney, salesDocumentStatusLabel, type SalesListQuery } from '@erp/shared';
import { usePermissions, useSales, useWarehouses } from '@/lib/auth-client';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
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
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Ventas"
        description="Ventas internas y su impacto operativo sobre precios y stock."
        actions={canCreate && (
          <Link href="/ventas/nueva" className={buttonVariants()}>
            <Plus className="size-4" />
            Nueva venta
          </Link>
        )}
      />

      <Toolbar>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por número o cliente…"
          className="max-w-64"
          aria-label="Buscar"
        />
        <Select
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value);
            setPage(1);
          }}
          className="max-w-48"
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
          className="max-w-40"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borrador</option>
          <option value="CONFIRMED">Confirmada</option>
          <option value="CANCELLED">Cancelada</option>
        </Select>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Depósito</th>
              <th className="px-4 py-2">Lista</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {salesQuery.isLoading && <TableRowsSkeleton columns={7} />}
            {items.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap">
                  <Link href={`/ventas/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                    {s.number}
                  </Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDate(s.occurredAt)}</td>
                <td className="px-4 py-2">{s.customer.legalName}</td>
                <td className="px-4 py-2 whitespace-nowrap">{s.warehouse.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{s.priceList.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(s.total, s.currencyCode)}</td>
                <td className="px-4 py-2">
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
