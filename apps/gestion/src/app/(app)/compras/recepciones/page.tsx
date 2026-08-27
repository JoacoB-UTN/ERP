'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { purchaseReceiptStatusLabel, PurchaseReceiptStatus } from '@erp/shared';
import { usePermissions, usePurchaseReceipts } from '@/lib/auth-client';
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

export default function RecepcionesPage() {
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

  const receiptsQuery = usePurchaseReceipts({
    search: search || undefined,
    status: (status || undefined) as PurchaseReceiptStatus | undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('purchases.goods-receipts.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('purchases.goods-receipts.create');
  const items = receiptsQuery.data?.items ?? [];
  const pagination = receiptsQuery.data?.pagination;
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
        title="Recepciones"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'recepción' : 'recepciones'}`}
        actions={canCreate && (
          <Link href="/compras/recepciones/nueva" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Nueva recepción
          </Link>
        )}
      />

      <Toolbar>
        <Input
          placeholder="Buscar por número o proveedor…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-8 max-w-sm py-1 text-sm"
          aria-label="Buscar recepciones"
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
          {Object.values(PurchaseReceiptStatus).map((value) => (
            <option key={value} value={value}>
              {purchaseReceiptStatusLabel(value)}
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
              <th className="px-3 py-1.5">Depósito</th>
              <th className="px-3 py-1.5">Orden de origen</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {receiptsQuery.isLoading && <TableRowsSkeleton columns={6} />}
            {items.map((receipt) => (
              <tr key={receipt.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1 whitespace-nowrap">
                  <Link
                    href={`/compras/recepciones/${receipt.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {receipt.number}
                  </Link>
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{formatDate(receipt.receiptDate)}</td>
                <td className="px-3 py-1">{receipt.supplier.legalName}</td>
                <td className="px-3 py-1 whitespace-nowrap">{receipt.warehouse.name}</td>
                <td className="px-3 py-1 whitespace-nowrap">
                  {receipt.purchaseOrder ? (
                    <Link
                      href={`/compras/ordenes/${receipt.purchaseOrder.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {receipt.purchaseOrder.number}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Directa</span>
                  )}
                </td>
                <td className="px-3 py-1">
                  <StatusBadge status={receipt.status}>{purchaseReceiptStatusLabel(receipt.status)}</StatusBadge>
                </td>
              </tr>
            ))}
            {receiptsQuery.isError && (
              <TableMessage
                columns={6}
                kind="error"
                title="No pudimos cargar las recepciones"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => receiptsQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!receiptsQuery.isLoading && !receiptsQuery.isError && items.length === 0 && !hasActiveFilters && (
              <TableMessage
                columns={6}
                title="Todavía no hay recepciones"
                description="Registrá la primera recepción de mercadería, con o sin orden de compra."
                action={canCreate && (
                  <Link href="/compras/recepciones/nueva" className={`${buttonVariants()} mt-4`}>
                    <Plus className="size-4" />
                    Nueva recepción
                  </Link>
                )}
              />
            )}
            {!receiptsQuery.isLoading && !receiptsQuery.isError && items.length === 0 && hasActiveFilters && (
              <TableMessage
                columns={6}
                kind="filtered"
                title="No encontramos recepciones"
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
          itemLabel={pagination.total === 1 ? 'recepción' : 'recepciones'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
