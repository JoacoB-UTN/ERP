'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDecimalDisplay, MovementType, movementTypeLabel, type MovementListQuery } from '@erp/shared';
import { usePermissions, useMovements, useWarehouses } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { ListHeader } from '@/components/ui/page-header';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';

const PAGE_SIZE = 25;

function qty(value: string): string {
  return formatDecimalDisplay(value, 6) ?? value;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function MovimientosPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const movementsQuery = useMovements({
    search: search || undefined,
    // End-of-day so the selected "hasta" date is inclusive, same convention as Auditoría.
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`) : undefined,
    warehouseId: warehouseId || undefined,
    movementType: (movementType || undefined) as MovementType | undefined,
    page,
    pageSize: PAGE_SIZE,
  } satisfies Partial<MovementListQuery>);

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.movements.read')) {
    return <Unauthorized />;
  }

  function resetPageAnd<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }

  const items = movementsQuery.data?.items ?? [];
  const pagination = movementsQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const hasActiveFilters = !!(search || dateFrom || dateTo || warehouseId || movementType);

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setWarehouseId('');
    setMovementType('');
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Movimientos"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'movimiento' : 'movimientos'}`}
      />

      <Toolbar>
        <div className="flex items-center gap-1.5">
          <label htmlFor="mDateFrom" className="text-xs text-muted-foreground">
            Desde
          </label>
          <Input
            id="mDateFrom"
            type="date"
            value={dateFrom}
            onChange={(e) => resetPageAnd(setDateFrom)(e.target.value)}
            className="h-8 py-1 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="mDateTo" className="text-xs text-muted-foreground">
            Hasta
          </label>
          <Input
            id="mDateTo"
            type="date"
            value={dateTo}
            onChange={(e) => resetPageAnd(setDateTo)(e.target.value)}
            className="h-8 py-1 text-sm"
          />
        </div>
        <Select
          value={warehouseId}
          onChange={(e) => resetPageAnd(setWarehouseId)(e.target.value)}
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
          value={movementType}
          onChange={(e) => resetPageAnd(setMovementType)(e.target.value)}
          className="h-8 max-w-40 py-1 text-sm"
          aria-label="Tipo de movimiento"
        >
          <option value="">Todos los tipos</option>
          {Object.values(MovementType).map((value) => (
            <option key={value} value={value}>
              {movementTypeLabel(value)}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Producto, SKU…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-8 max-w-48 py-1 text-sm"
          aria-label="Buscar movimientos"
        />
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Fecha</th>
              <th className="px-3 py-1.5">Depósito</th>
              <th className="px-3 py-1.5">Producto</th>
              <th className="px-3 py-1.5">Tipo</th>
              <th className="px-3 py-1.5 text-right">Cantidad</th>
              <th className="px-3 py-1.5">Usuario</th>
            </tr>
          </thead>
          <tbody>
            {movementsQuery.isLoading && <TableRowsSkeleton columns={6} />}
            {items.map((m) => {
              const signed = Number(m.quantity);
              return (
                <tr key={m.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{formatDateTime(m.occurredAt)}</td>
                  <td className="px-3 py-1 whitespace-nowrap">{m.warehouse.name}</td>
                  <td className="px-3 py-1">
                    <Link href={`/stock/movimientos/${m.id}`} className="underline-offset-4 hover:underline">
                      {m.productName}
                    </Link>
                    {(m.variantName || m.sku) && (
                      <p className="text-xs text-muted-foreground">
                        {m.variantName}
                        {m.variantName && m.sku ? ' · ' : ''}
                        {m.sku}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap">{movementTypeLabel(m.movementType)}</td>
                  <td
                    className={`px-3 py-1 text-right tabular-nums ${signed < 0 ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    {signed > 0 ? '+' : ''}
                    {qty(m.quantity)}
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap">{m.createdBy?.name ?? 'Sistema'}</td>
                </tr>
              );
            })}
            {movementsQuery.isError && (
              <TableMessage
                columns={6}
                kind="error"
                title="No pudimos cargar los movimientos"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => movementsQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!movementsQuery.isLoading && !movementsQuery.isError && items.length === 0 && (
              <TableMessage
                columns={6}
                kind={hasActiveFilters ? 'filtered' : 'empty'}
                title={hasActiveFilters ? 'No encontramos movimientos' : 'Todavía no hay movimientos'}
                description={hasActiveFilters ? 'Probá con otros criterios o limpiá los filtros.' : 'Los movimientos aparecerán al operar sobre el stock.'}
                action={hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                )}
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
          itemLabel={pagination.total === 1 ? 'movimiento' : 'movimientos'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
