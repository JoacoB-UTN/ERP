'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDecimalDisplay, MovementType, movementTypeLabel, type MovementListQuery } from '@erp/shared';
import { usePermissions, useMovements, useWarehouses } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { StockSubNav } from '@/components/stock/stock-sub-nav';

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

  return (
    <div className="flex flex-col gap-6">
      <StockSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Movimientos</h1>
        <p className="text-sm text-muted-foreground">
          Historial completo e inmutable del inventario — el libro mayor de existencias.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mDateFrom">Desde</Label>
            <Input id="mDateFrom" type="date" value={dateFrom} onChange={(e) => resetPageAnd(setDateFrom)(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mDateTo">Hasta</Label>
            <Input id="mDateTo" type="date" value={dateTo} onChange={(e) => resetPageAnd(setDateTo)(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mWarehouse">Depósito</Label>
            <Select
              id="mWarehouse"
              value={warehouseId}
              onChange={(e) => resetPageAnd(setWarehouseId)(e.target.value)}
            >
              <option value="">Todos</option>
              {warehousesQuery.data?.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mType">Tipo</Label>
            <Select id="mType" value={movementType} onChange={(e) => resetPageAnd(setMovementType)(e.target.value)}>
              <option value="">Todos</option>
              {Object.values(MovementType).map((value) => (
                <option key={value} value={value}>
                  {movementTypeLabel(value)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mSearch">Buscar</Label>
            <Input
              id="mSearch"
              placeholder="Producto, SKU…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Depósito</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2 text-right">Cantidad</th>
              <th className="px-4 py-2">Usuario</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => {
              const signed = Number(m.quantity);
              return (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(m.occurredAt)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{m.warehouse.name}</td>
                  <td className="px-4 py-2">
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
                  <td className="px-4 py-2 whitespace-nowrap">{movementTypeLabel(m.movementType)}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${signed < 0 ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    {signed > 0 ? '+' : ''}
                    {qty(m.quantity)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{m.createdBy?.name ?? 'Sistema'}</td>
                </tr>
              );
            })}
            {!movementsQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No se encontraron movimientos con esos criterios.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {totalPages} — {pagination.total} movimiento
            {pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
