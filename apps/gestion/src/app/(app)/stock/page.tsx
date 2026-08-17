'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDecimalDisplay, ProductStatus, type StockListQuery } from '@erp/shared';
import {
  usePermissions,
  useStock,
  useWarehouses,
  useProductCategories,
  useBrands,
} from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Unauthorized } from '@/components/layout/unauthorized';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';

const PAGE_SIZE = 25;

function qty(value: string): string {
  return formatDecimalDisplay(value, 6) ?? value;
}

export default function ExistenciasPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();
  const categoriesQuery = useProductCategories();
  const brandsQuery = useBrands();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [belowMinimum, setBelowMinimum] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const stockQuery = useStock({
    search: search || undefined,
    warehouseId: warehouseId || undefined,
    status: (status || undefined) as ProductStatus | undefined,
    categoryId: categoryId || undefined,
    brandId: brandId || undefined,
    belowMinimum: belowMinimum || undefined,
    page,
    pageSize: PAGE_SIZE,
  } satisfies Partial<StockListQuery>);

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.stock.read')) {
    return <Unauthorized />;
  }

  const items = stockQuery.data?.items ?? [];
  const pagination = stockQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const hasActiveFilters = !!(search || warehouseId || status || categoryId || brandId || belowMinimum);

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setWarehouseId('');
    setStatus('');
    setCategoryId('');
    setBrandId('');
    setBelowMinimum(false);
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Existencias"
        description="Físico, reservado y disponible por depósito, calculado desde el movimiento de inventario."
      />

      <Toolbar>
        <Input
          placeholder="Buscar por nombre, código, SKU…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-sm"
          aria-label="Buscar existencias"
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
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          className="max-w-48"
          aria-label="Categoría"
        >
          <option value="">Todas las categorías</option>
          {categoriesQuery.data?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={brandId}
          onChange={(e) => {
            setBrandId(e.target.value);
            setPage(1);
          }}
          className="max-w-44"
          aria-label="Marca"
        >
          <option value="">Todas las marcas</option>
          {brandsQuery.data?.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
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
          aria-label="Estado del producto"
        >
          <option value="">Todos los estados</option>
          <option value="ACTIVE">Activo</option>
          <option value="INACTIVE">Inactivo</option>
        </Select>
        <label className="flex h-(--control-height) items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={belowMinimum}
            onChange={(e) => {
              setBelowMinimum(e.target.checked);
              setPage(1);
            }}
            className="size-3.5"
          />
          Solo debajo del mínimo
        </label>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Depósito</th>
              <th className="px-4 py-2 text-right">Físico</th>
              <th className="px-4 py-2 text-right">Reservado</th>
              <th className="px-4 py-2 text-right">Disponible</th>
            </tr>
          </thead>
          <tbody>
            {stockQuery.isLoading && <TableRowsSkeleton columns={6} />}
            {items.map((row) => {
              const onHand = Number(row.onHand);
              const available = Number(row.available);
              return (
                <tr key={`${row.variantId}-${row.warehouse.id}`} className="border-t border-border">
                  <td className="px-4 py-2">
                    <Link
                      href={`/productos/${row.productId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.productName}
                    </Link>
                    {row.variantName && <p className="text-xs text-muted-foreground">{row.variantName}</p>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{row.sku ?? '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{row.warehouse.name}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${onHand < 0 ? 'text-red-600' : ''}`}>
                    {qty(row.onHand)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{qty(row.reserved)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${available < 0 ? 'text-red-600' : ''}`}>
                    <span>{qty(row.available)}</span>
                    {row.belowMinimum && (
                      <StatusBadge tone="warning" className="ml-2 normal-case">
                        Bajo mínimo
                      </StatusBadge>
                    )}
                  </td>
                </tr>
              );
            })}
            {stockQuery.isError && (
              <TableMessage
                columns={6}
                kind="error"
                title="No pudimos cargar las existencias"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => stockQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!stockQuery.isLoading && !stockQuery.isError && items.length === 0 && !hasActiveFilters && (
              <TableMessage
                columns={6}
                title="Todavía no hay existencias registradas"
                description="La carga inicial o un ajuste confirmado generarán el primer movimiento."
              />
            )}
            {!stockQuery.isLoading && !stockQuery.isError && items.length === 0 && hasActiveFilters && (
              <TableMessage
                columns={6}
                kind="filtered"
                title="No encontramos existencias"
                description="Probá con otros criterios o limpiá los filtros."
                action={<button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Limpiar filtros
                  </button>}
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
          itemLabel={pagination.total === 1 ? 'fila' : 'filas'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
