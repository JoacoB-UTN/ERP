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
import { buttonVariants } from '@/components/ui/button';
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">Maestro de clientes de esta empresa.</p>
        </div>
        {canCreate && (
          <Link href="/clientes/nuevo" className={buttonVariants()}>
            <Plus className="size-4" />
            Nuevo cliente
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
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
                  {customer.status === 'ACTIVE' ? (
                    <span className="text-emerald-600">Activo</span>
                  ) : (
                    <span className="text-muted-foreground">Inactivo</span>
                  )}
                </td>
              </tr>
            ))}
            {!customersQuery.isLoading && items.length === 0 && !hasActiveFilters && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="text-muted-foreground">Todavía no hay clientes.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Creá el primer cliente para comenzar.</p>
                  {canCreate && (
                    <Link href="/clientes/nuevo" className={`${buttonVariants()} mt-4`}>
                      <Plus className="size-4" />
                      Nuevo cliente
                    </Link>
                  )}
                </td>
              </tr>
            )}
            {!customersQuery.isLoading && items.length === 0 && hasActiveFilters && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="text-muted-foreground">No encontramos clientes con esos criterios.</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-2 text-sm underline-offset-4 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {totalPages} — {pagination.total} cliente
            {pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-2.5 py-1 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-2.5 py-1 disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
