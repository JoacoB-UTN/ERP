'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, ArrowRight } from 'lucide-react';
import { stockTransferStatusLabel, type StockTransferListQuery } from '@erp/shared';
import { usePermissions, useStockTransfers, useWarehouses } from '@/lib/auth-client';
import { Select } from '@/components/ui/select';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  LinkedRow,
  Pagination,
  RowLink,
  TableMessage,
  TableRowsSkeleton,
} from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';

const PAGE_SIZE = 25;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

export default function TransferenciasPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();

  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const transfersQuery = useStockTransfers({
    warehouseId: warehouseId || undefined,
    status: (status || undefined) as StockTransferListQuery['status'],
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.transfers.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('inventory.transfers.create');
  const items = transfersQuery.data?.items ?? [];
  const pagination = transfersQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const filtered = Boolean(warehouseId || status);

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Transferencias"
        meta={
          pagination &&
          `${pagination.total} ${pagination.total === 1 ? 'transferencia' : 'transferencias'}`
        }
      />

      <Toolbar
        actions={
          canCreate && (
            <Link href="/stock/transferencias/nueva" className={buttonVariants({ size: 'sm' })}>
              <Plus className="size-4" />
              Nueva transferencia
            </Link>
          )
        }
      >
        <Select
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value);
            setPage(1);
          }}
          className="h-8 max-w-48 py-1 text-sm"
          aria-label="Depósito"
        >
          {/* Matches either end: the API filters on origin OR destination. */}
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
          <option value="CONFIRMED">Confirmada</option>
          <option value="CANCELLED">Anulada</option>
        </Select>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Número</th>
              <th className="px-3 py-1.5">Fecha</th>
              <th className="px-3 py-1.5">Origen → Destino</th>
              <th className="px-3 py-1.5">Motivo</th>
              <th className="px-3 py-1.5">Líneas</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {transfersQuery.isLoading && <TableRowsSkeleton columns={6} />}
            {items.map((t) => (
              <LinkedRow key={t.id}>
                <td className="px-3 py-1 whitespace-nowrap">
                  <RowLink href={`/stock/transferencias/${t.id}`}>{t.number}</RowLink>
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                  {formatDate(t.occurredAt)}
                </td>
                <td className="px-3 py-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {t.sourceWarehouseName}
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="hacia" />
                    {t.destinationWarehouseName}
                  </span>
                </td>
                <td className="px-3 py-1">{t.reason ?? '—'}</td>
                <td className="px-3 py-1">{t.lineCount}</td>
                <td className="px-3 py-1">
                  <StatusBadge status={t.status}>{stockTransferStatusLabel(t.status)}</StatusBadge>
                </td>
              </LinkedRow>
            ))}
            {transfersQuery.isError && (
              <TableMessage
                columns={6}
                kind="error"
                title="No pudimos cargar las transferencias"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => transfersQuery.refetch()}
                  >
                    Reintentar
                  </Button>
                }
              />
            )}
            {!transfersQuery.isLoading && !transfersQuery.isError && items.length === 0 && (
              <TableMessage
                columns={6}
                kind={filtered ? 'filtered' : 'empty'}
                title={
                  filtered
                    ? 'No encontramos transferencias'
                    : 'Todavía no hay transferencias registradas'
                }
                description={
                  filtered
                    ? 'Probá con otros filtros.'
                    : 'Creá una transferencia para mover stock entre dos depósitos.'
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
          itemLabel={pagination.total === 1 ? 'transferencia' : 'transferencias'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
