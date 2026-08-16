'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, ClipboardPlus } from 'lucide-react';
import { stockAdjustmentStatusLabel, type StockAdjustmentListQuery } from '@erp/shared';
import { usePermissions, useStockAdjustments, useWarehouses } from '@/lib/auth-client';
import { Select } from '@/components/ui/select';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { StockSubNav } from '@/components/stock/stock-sub-nav';

const PAGE_SIZE = 25;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

function statusClassName(status: string): string {
  if (status === 'CONFIRMED') return 'text-emerald-600';
  if (status === 'CANCELLED') return 'text-muted-foreground';
  return 'text-amber-600';
}

export default function AjustesPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();

  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const adjustmentsQuery = useStockAdjustments({
    warehouseId: warehouseId || undefined,
    status: (status || undefined) as StockAdjustmentListQuery['status'],
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.adjustments.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('inventory.adjustments.create');
  const canCreateInitialBalance = can('inventory.initial-balance.create');
  const items = adjustmentsQuery.data?.items ?? [];
  const pagination = adjustmentsQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <StockSubNav />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
          <p className="text-sm text-muted-foreground">
            Correcciones manuales de inventario. Un ajuste confirmado genera movimientos y no puede modificarse.
          </p>
        </div>
        <div className="flex gap-2">
          {canCreateInitialBalance && (
            <Link href="/stock/ajustes/carga-inicial" className={buttonVariants({ variant: 'outline' })}>
              <ClipboardPlus className="size-4" />
              Carga inicial
            </Link>
          )}
          {canCreate && (
            <Link href="/stock/ajustes/nuevo" className={buttonVariants()}>
              <Plus className="size-4" />
              Nuevo ajuste
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
          <option value="CONFIRMED">Confirmado</option>
          <option value="CANCELLED">Cancelado</option>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Depósito</th>
              <th className="px-4 py-2">Motivo</th>
              <th className="px-4 py-2">Líneas</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap">
                  <Link href={`/stock/ajustes/${a.id}`} className="font-medium underline-offset-4 hover:underline">
                    {a.number}
                  </Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDate(a.occurredAt)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{a.warehouseName}</td>
                <td className="px-4 py-2">{a.reason}</td>
                <td className="px-4 py-2">{a.lineCount}</td>
                <td className={`px-4 py-2 ${statusClassName(a.status)}`}>{stockAdjustmentStatusLabel(a.status)}</td>
              </tr>
            ))}
            {!adjustmentsQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay ajustes registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {totalPages} — {pagination.total} ajuste{pagination.total === 1 ? '' : 's'}
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
