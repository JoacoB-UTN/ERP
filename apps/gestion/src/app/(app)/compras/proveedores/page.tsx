'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { SupplierStatus, supplierStatusLabel } from '@erp/shared';
import { usePermissions, useSuppliers } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button, buttonVariants } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';

const PAGE_SIZE = 25;

export default function ProveedoresPage() {
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

  const suppliersQuery = useSuppliers({
    search: search || undefined,
    status: (status || undefined) as SupplierStatus | undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('purchases.suppliers.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('purchases.suppliers.create');
  const items = suppliersQuery.data?.items ?? [];
  const pagination = suppliersQuery.data?.pagination;
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
        title="Proveedores"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'proveedor' : 'proveedores'}`}
        actions={canCreate && (
          <Link href="/compras/proveedores/nuevo" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Nuevo proveedor
          </Link>
        )}
      />

      <Toolbar>
        <Input
          placeholder="Buscar por nombre, código, CUIT…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-8 max-w-sm py-1 text-sm"
          aria-label="Buscar proveedores"
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
          {Object.values(SupplierStatus).map((value) => (
            <option key={value} value={value}>
              {supplierStatusLabel(value)}
            </option>
          ))}
        </Select>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Código</th>
              <th className="px-3 py-1.5">Proveedor</th>
              <th className="px-3 py-1.5">CUIT / Documento</th>
              <th className="px-3 py-1.5">Teléfono</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {suppliersQuery.isLoading && <TableRowsSkeleton columns={5} />}
            {items.map((supplier) => (
              <tr key={supplier.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{supplier.code}</td>
                <td className="px-3 py-1">
                  <Link
                    href={`/compras/proveedores/${supplier.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {supplier.displayName}
                  </Link>
                  {supplier.tradeName && (
                    <p className="text-xs text-muted-foreground">{supplier.legalName}</p>
                  )}
                </td>
                <td className="px-3 py-1 whitespace-nowrap">{supplier.taxIdFormatted ?? '—'}</td>
                <td className="px-3 py-1 whitespace-nowrap">{supplier.phone ?? '—'}</td>
                <td className="px-3 py-1">
                  <StatusBadge status={supplier.status}>{supplierStatusLabel(supplier.status)}</StatusBadge>
                </td>
              </tr>
            ))}
            {suppliersQuery.isError && (
              <TableMessage
                columns={5}
                kind="error"
                title="No pudimos cargar los proveedores"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => suppliersQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!suppliersQuery.isLoading && !suppliersQuery.isError && items.length === 0 && !hasActiveFilters && (
              <TableMessage
                columns={5}
                title="Todavía no hay proveedores"
                description="Creá el primer proveedor para comenzar a generar órdenes de compra."
                action={canCreate && (
                  <Link href="/compras/proveedores/nuevo" className={`${buttonVariants()} mt-4`}>
                    <Plus className="size-4" />
                    Nuevo proveedor
                  </Link>
                )}
              />
            )}
            {!suppliersQuery.isLoading && !suppliersQuery.isError && items.length === 0 && hasActiveFilters && (
              <TableMessage
                columns={5}
                kind="filtered"
                title="No encontramos proveedores"
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
          itemLabel={pagination.total === 1 ? 'proveedor' : 'proveedores'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
