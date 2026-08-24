'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, ClipboardPlus } from 'lucide-react';
import { stockAdjustmentStatusLabel, type StockAdjustmentListQuery } from '@erp/shared';
import { usePermissions, useStockAdjustments, useWarehouses } from '@/lib/auth-client';
import { Select } from '@/components/ui/select';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';

const PAGE_SIZE = 25;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
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
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Ajustes"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'ajuste' : 'ajustes'}`}
        actions={<>
          {canCreateInitialBalance && (
            <Link href="/stock/ajustes/carga-inicial" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <ClipboardPlus className="size-4" />
              Carga inicial
            </Link>
          )}
          {canCreate && (
            <Link href="/stock/ajustes/nuevo" className={buttonVariants({ size: 'sm' })}>
              <Plus className="size-4" />
              Nuevo ajuste
            </Link>
          )}
        </>}
      />

      <Toolbar>
        <Select
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value);
            setPage(1);
          }}
          className="h-8 max-w-48 py-1 text-sm"
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
          className="h-8 max-w-40 py-1 text-sm"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borrador</option>
          <option value="CONFIRMED">Confirmado</option>
          <option value="CANCELLED">Cancelado</option>
        </Select>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Número</th>
              <th className="px-3 py-1.5">Fecha</th>
              <th className="px-3 py-1.5">Depósito</th>
              <th className="px-3 py-1.5">Motivo</th>
              <th className="px-3 py-1.5">Líneas</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {adjustmentsQuery.isLoading && <TableRowsSkeleton columns={6} />}
            {items.map((a) => (
              <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1 whitespace-nowrap">
                  <Link href={`/stock/ajustes/${a.id}`} className="font-medium underline-offset-4 hover:underline">
                    {a.number}
                  </Link>
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{formatDate(a.occurredAt)}</td>
                <td className="px-3 py-1 whitespace-nowrap">{a.warehouseName}</td>
                <td className="px-3 py-1">{a.reason}</td>
                <td className="px-3 py-1">{a.lineCount}</td>
                <td className="px-3 py-1">
                  <StatusBadge status={a.status}>{stockAdjustmentStatusLabel(a.status)}</StatusBadge>
                </td>
              </tr>
            ))}
            {adjustmentsQuery.isError && (
              <TableMessage
                columns={6}
                kind="error"
                title="No pudimos cargar los ajustes"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => adjustmentsQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!adjustmentsQuery.isLoading && !adjustmentsQuery.isError && items.length === 0 && (
              <TableMessage
                columns={6}
                kind={warehouseId || status ? 'filtered' : 'empty'}
                title={warehouseId || status ? 'No encontramos ajustes' : 'Todavía no hay ajustes registrados'}
                description={warehouseId || status ? 'Probá con otros filtros.' : 'Creá un ajuste cuando necesites corregir existencias.'}
                action={!warehouseId && !status && canCreate && (
                  <Link href="/stock/ajustes/nuevo" className={buttonVariants()}>
                    <Plus className="size-4" />
                    Nuevo ajuste
                  </Link>
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
          itemLabel={pagination.total === 1 ? 'ajuste' : 'ajustes'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
