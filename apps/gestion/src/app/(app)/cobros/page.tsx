'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  customerCollectionStatusLabel,
  formatMoney,
  salesTenderMethodLabel,
  type CustomerCollectionListQuery,
} from '@erp/shared';

import { usePermissions, useCustomerCollections } from '@/lib/auth-client';
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

export default function CobrosPage() {
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

  const collectionsQuery = useCustomerCollections({
    search: search || undefined,
    status: (status || undefined) as CustomerCollectionListQuery['status'],
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('treasury.receipts.read')) {
    return <Unauthorized />;
  }

  const items = collectionsQuery.data?.items ?? [];
  const pagination = collectionsQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const canCreate = can('treasury.receipts.create');

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Cobros"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'cobro' : 'cobros'}`}
      />

      <Toolbar
        actions={
          canCreate && (
            <Link href="/cobros/nuevo" className={buttonVariants({ size: 'sm' })}>
              <Plus className="size-4" />
              Nuevo cobro
            </Link>
          )
        }
      >
        <Input
          placeholder="Buscar por número o cliente…"
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
              <th className="px-3 py-1.5">Cliente</th>
              <th className="px-3 py-1.5">Medio</th>
              <th className="px-3 py-1.5 text-right">Importe</th>
              <th className="px-3 py-1.5 text-right">Sin aplicar</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {collectionsQuery.isLoading && <TableRowsSkeleton columns={7} />}
            {items.map((c) => (
              <LinkedRow key={c.id}>
                <td className="px-3 py-1 whitespace-nowrap">
                  <RowLink href={`/cobros/${c.id}`}>{c.number}</RowLink>
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                  {formatDate(c.occurredAt)}
                </td>
                <td className="px-3 py-1">{c.customer.legalName}</td>
                <td className="px-3 py-1 whitespace-nowrap">{salesTenderMethodLabel(c.paymentMethod)}</td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {formatMoney(c.amount, c.currencyCode)}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {/* Blank rather than a zero: "fully applied" is the normal
                      case, and a column of zeros hides the few rows that do
                      carry unapplied credit. */}
                  {Number(c.unappliedAmount) !== 0 ? formatMoney(c.unappliedAmount, c.currencyCode) : ''}
                </td>
                <td className="px-3 py-1">
                  <StatusBadge status={c.status}>{customerCollectionStatusLabel(c.status)}</StatusBadge>
                </td>
              </LinkedRow>
            ))}
            {collectionsQuery.isError && (
              <TableMessage
                columns={7}
                kind="error"
                title="No pudimos cargar los cobros"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => collectionsQuery.refetch()}
                  >
                    Reintentar
                  </Button>
                }
              />
            )}
            {!collectionsQuery.isLoading && !collectionsQuery.isError && items.length === 0 && (
              <TableMessage
                columns={7}
                kind={search || status ? 'filtered' : 'empty'}
                title={search || status ? 'No encontramos cobros' : 'Todavía no hay cobros'}
                description={
                  search || status ? 'Probá con otro número, cliente o estado.' : undefined
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
          itemLabel={pagination.total === 1 ? 'cobro' : 'cobros'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
