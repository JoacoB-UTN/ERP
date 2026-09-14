'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  supplierPaymentStatusLabel,
  formatMoney,
  salesTenderMethodLabel,
  type SupplierPaymentListQuery,
} from '@erp/shared';

import { usePermissions, useSupplierPayments } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  LinkedRow,
  Pagination,
  RowLink,
  TableMessage,
  TableRowsSkeleton,
} from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';

const PAGE_SIZE = 25;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

export default function PagosPage() {
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

  const paymentsQuery = useSupplierPayments({
    search: search || undefined,
    status: (status || undefined) as SupplierPaymentListQuery['status'],
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('treasury.payments.read')) {
    return <Unauthorized />;
  }

  const items = paymentsQuery.data?.items ?? [];
  const pagination = paymentsQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const canCreate = can('treasury.payments.create');

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Pagos"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'pago' : 'pagos'}`}
      />

      <Toolbar
        actions={
          canCreate && (
            <Link href="/pagos/nuevo" className={buttonVariants({ size: 'sm' })}>
              <Plus className="size-4" />
              Nuevo pago
            </Link>
          )
        }
      >
        <Input
          placeholder="Buscar por número o proveedor…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-8 max-w-64 py-1 text-sm"
          aria-label="Buscar"
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
          <option value="DRAFT">Borradores</option>
          <option value="CONFIRMED">Confirmados</option>
          <option value="CANCELLED">Anulados</option>
        </Select>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Número</th>
              <th className="px-3 py-1.5">Fecha</th>
              <th className="px-3 py-1.5">Proveedor</th>
              <th className="px-3 py-1.5">Medio</th>
              <th className="px-3 py-1.5 text-right">Importe</th>
              <th className="px-3 py-1.5 text-right">Sin aplicar</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {paymentsQuery.isLoading && <TableRowsSkeleton columns={7} />}
            {items.map((p) => (
              <LinkedRow key={p.id}>
                <td className="px-3 py-1 whitespace-nowrap">
                  <RowLink href={`/pagos/${p.id}`}>{p.number}</RowLink>
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                  {formatDate(p.occurredAt)}
                </td>
                <td className="px-3 py-1">{p.supplier.legalName}</td>
                <td className="px-3 py-1 whitespace-nowrap">{salesTenderMethodLabel(p.paymentMethod)}</td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {formatMoney(p.amount, p.currencyCode)}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {/* Blank rather than a zero: "fully applied" is the normal
                      case, and a column of zeros hides the few rows that do
                      carry unapplied credit. */}
                  {Number(p.unappliedAmount) !== 0 ? formatMoney(p.unappliedAmount, p.currencyCode) : ''}
                </td>
                <td className="px-3 py-1">
                  <StatusBadge status={p.status}>{supplierPaymentStatusLabel(p.status)}</StatusBadge>
                </td>
              </LinkedRow>
            ))}
            {paymentsQuery.isError && (
              <TableMessage
                columns={7}
                kind="error"
                title="No pudimos cargar los pagos"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => paymentsQuery.refetch()}
                  >
                    Reintentar
                  </Button>
                }
              />
            )}
            {!paymentsQuery.isLoading && !paymentsQuery.isError && items.length === 0 && (
              <TableMessage
                columns={7}
                kind={search || status ? 'filtered' : 'empty'}
                title={search || status ? 'No encontramos pagos' : 'Todavía no hay pagos'}
                description={
                  search || status ? 'Probá con otro número, proveedor o estado.' : undefined
                }
              />
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={pagination.total}
          itemLabel={pagination.total === 1 ? 'pago' : 'pagos'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
