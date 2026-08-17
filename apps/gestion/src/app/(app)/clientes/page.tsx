'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  CustomerStatus,
  CustomerType,
  CustomerTaxCondition,
  customerTypeLabel,
  customerTaxConditionLabel,
  customerStatusLabel,
} from '@erp/shared';
import { usePermissions, useCustomers } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';

const PAGE_SIZE = 25;

export default function ClientesPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [taxCondition, setTaxCondition] = useState('');
  const [page, setPage] = useState(1);

  // Debounced search — no "Buscar" button needed for ordinary lookup.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const customersQuery = useCustomers({
    search: search || undefined,
    status: (status || undefined) as CustomerStatus | undefined,
    customerType: (customerType || undefined) as CustomerType | undefined,
    taxCondition: (taxCondition || undefined) as CustomerTaxCondition | undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('customers.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('customers.create');
  const items = customersQuery.data?.items ?? [];
  const pagination = customersQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const hasActiveFilters = !!(search || status || customerType || taxCondition);

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setCustomerType('');
    setTaxCondition('');
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Clientes"
        description="Identidad, datos fiscales y contactos de los clientes de esta empresa."
        actions={canCreate && (
          <Link href="/clientes/nuevo" className={buttonVariants()}>
            <Plus className="size-4" />
            Nuevo cliente
          </Link>
        )}
      />

      <Toolbar>
        <Input
          placeholder="Buscar por nombre, código, CUIT, email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-sm"
          aria-label="Buscar clientes"
        />
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
          {Object.values(CustomerStatus).map((value) => (
            <option key={value} value={value}>
              {customerStatusLabel(value)}
            </option>
          ))}
        </Select>
        <Select
          value={customerType}
          onChange={(e) => {
            setCustomerType(e.target.value);
            setPage(1);
          }}
          className="max-w-44"
          aria-label="Tipo de cliente"
        >
          <option value="">Todos los tipos</option>
          {Object.values(CustomerType).map((value) => (
            <option key={value} value={value}>
              {customerTypeLabel(value)}
            </option>
          ))}
        </Select>
        <Select
          value={taxCondition}
          onChange={(e) => {
            setTaxCondition(e.target.value);
            setPage(1);
          }}
          className="max-w-52"
          aria-label="Condición fiscal"
        >
          <option value="">Todas las condiciones</option>
          {Object.values(CustomerTaxCondition).map((value) => (
            <option key={value} value={value}>
              {customerTaxConditionLabel(value)}
            </option>
          ))}
        </Select>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">CUIT / Documento</th>
              <th className="px-4 py-2">Condición fiscal</th>
              <th className="px-4 py-2">Teléfono</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {customersQuery.isLoading && <TableRowsSkeleton columns={6} />}
            {items.map((customer) => (
              <tr key={customer.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{customer.code}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/clientes/${customer.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {customer.displayName}
                  </Link>
                  {customer.tradeName && (
                    <p className="text-xs text-muted-foreground">{customer.legalName}</p>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{customer.taxIdFormatted ?? '—'}</td>
                <td className="px-4 py-2">
                  {customer.taxCondition ? customerTaxConditionLabel(customer.taxCondition) : '—'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{customer.phone ?? '—'}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={customer.status}>{customerStatusLabel(customer.status)}</StatusBadge>
                </td>
              </tr>
            ))}
            {customersQuery.isError && (
              <TableMessage
                columns={6}
                kind="error"
                title="No pudimos cargar los clientes"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => customersQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!customersQuery.isLoading && !customersQuery.isError && items.length === 0 && !hasActiveFilters && (
              <TableMessage
                columns={6}
                title="Todavía no hay clientes"
                description="Creá el primer cliente para comenzar."
                action={canCreate && (
                    <Link href="/clientes/nuevo" className={`${buttonVariants()} mt-4`}>
                      <Plus className="size-4" />
                      Nuevo cliente
                    </Link>
                )}
              />
            )}
            {!customersQuery.isLoading && !customersQuery.isError && items.length === 0 && hasActiveFilters && (
              <TableMessage
                columns={6}
                kind="filtered"
                title="No encontramos clientes"
                description="Probá con otros criterios o limpiá los filtros."
                action={<button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Limpiar filtros
                  </button>}
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
          itemLabel={pagination.total === 1 ? 'cliente' : 'clientes'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
