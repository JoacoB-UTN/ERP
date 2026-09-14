'use client';

import { useEffect, useState } from 'react';

import { usePermissions, useCustomerAccounts } from '@/lib/auth-client';
import { BalanceCell } from '@/components/cuentas/balance-cell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListHeader } from '@/components/ui/page-header';
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

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' }) : '—';
}

export default function CuentasClientesPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const accountsQuery = useCustomerAccounts({
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('accounts.receivable.read')) {
    return <Unauthorized />;
  }

  const items = accountsQuery.data?.items ?? [];
  const pagination = accountsQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Cuentas corrientes de clientes"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'cliente' : 'clientes'}`}
      />

      <Toolbar>
        <Input
          placeholder="Buscar cliente…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-8 max-w-xs py-1 text-sm"
          aria-label="Buscar cliente"
        />
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Código</th>
              <th className="px-3 py-1.5">Cliente</th>
              <th className="px-3 py-1.5">CUIT / Doc.</th>
              <th className="px-3 py-1.5 text-right">Saldo</th>
              <th className="px-3 py-1.5">Último movimiento</th>
            </tr>
          </thead>
          <tbody>
            {accountsQuery.isLoading && <TableRowsSkeleton columns={5} />}
            {items.map((account) => (
              <LinkedRow key={account.customerId}>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{account.code}</td>
                <td className="px-3 py-1">
                  <RowLink href={`/cuentas-corrientes/clientes/${account.customerId}`}>
                    {account.displayName}
                  </RowLink>
                </td>
                <td className="px-3 py-1 whitespace-nowrap">{account.taxIdFormatted ?? '—'}</td>
                <td className="px-3 py-1 text-right">
                  <BalanceCell balances={account.balances} side="customer" />
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                  {formatDate(account.lastMovementAt)}
                </td>
              </LinkedRow>
            ))}
            {accountsQuery.isError && (
              <TableMessage
                columns={5}
                kind="error"
                title="No pudimos cargar las cuentas"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => accountsQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!accountsQuery.isLoading && !accountsQuery.isError && items.length === 0 && (
              <TableMessage
                columns={5}
                kind={search ? 'filtered' : 'empty'}
                title={search ? 'No encontramos clientes' : 'Todavía no hay cuentas con movimientos'}
                description={
                  search
                    ? 'Probá con otro nombre o código.'
                    : 'Las cuentas aparecen acá cuando una venta o un cobro las mueve.'
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
          itemLabel={pagination.total === 1 ? 'cliente' : 'clientes'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
