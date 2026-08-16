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
import { StockSubNav } from '@/components/stock/stock-sub-nav';

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
    <div className="flex flex-col gap-6">
      <StockSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Existencias</h1>
        <p className="text-sm text-muted-foreground">
          Físico, reservado y disponible por depósito, calculado a partir del movimiento de inventario.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
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
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
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
                    {qty(row.available)}
                    {row.belowMinimum && (
                      <span
                        className="ml-1.5 inline-block size-1.5 rounded-full bg-amber-500 align-middle"
                        title="Por debajo del stock mínimo"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {!stockQuery.isLoading && items.length === 0 && !hasActiveFilters && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay existencias registradas.
                </td>
              </tr>
            )}
            {!stockQuery.isLoading && items.length === 0 && hasActiveFilters && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="text-muted-foreground">No encontramos existencias con esos criterios.</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-2 text-sm underline-offset-4 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {totalPages} — {pagination.total} fila{pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-2.5 py-1 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-2.5 py-1 disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
