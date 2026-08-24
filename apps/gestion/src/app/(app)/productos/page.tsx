'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  ProductStatus,
  ProductType,
  productTypeLabel,
} from '@erp/shared';
import { usePermissions, useProducts, useProductCategories } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button, buttonVariants } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';
import { ProductosSubNav } from '@/components/productos/productos-sub-nav';

const PAGE_SIZE = 25;

export default function ProductosPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const categoriesQuery = useProductCategories();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [productType, setProductType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);

  // Debounced search — no "Buscar" button needed for ordinary lookup.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const productsQuery = useProducts({
    search: search || undefined,
    status: (status || undefined) as ProductStatus | undefined,
    productType: (productType || undefined) as ProductType | undefined,
    categoryId: categoryId || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('products.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('products.create');
  const items = productsQuery.data?.items ?? [];
  const pagination = productsQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const hasActiveFilters = !!(search || status || productType || categoryId);

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setProductType('');
    setCategoryId('');
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ProductosSubNav />
      <ListHeader
        title="Productos"
        meta={pagination && `${pagination.total} ${pagination.total === 1 ? 'producto' : 'productos'}`}
        actions={canCreate && (
          <Link href="/productos/nuevo" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Nuevo producto
          </Link>
        )}
      />

      <Toolbar>
        <Input
          placeholder="Buscar por nombre, código, SKU, código de barras…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-8 max-w-sm py-1 text-sm"
          aria-label="Buscar productos"
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
          <option value="ACTIVE">Activo</option>
          <option value="INACTIVE">Inactivo</option>
        </Select>
        <Select
          value={productType}
          onChange={(e) => {
            setProductType(e.target.value);
            setPage(1);
          }}
          className="h-8 max-w-44 py-1 text-sm"
          aria-label="Tipo"
        >
          <option value="">Todos los tipos</option>
          {Object.values(ProductType).map((value) => (
            <option key={value} value={value}>
              {productTypeLabel(value)}
            </option>
          ))}
        </Select>
        <Select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          className="h-8 max-w-52 py-1 text-sm"
          aria-label="Categoría"
        >
          <option value="">Todas las categorías</option>
          {categoriesQuery.data?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Código</th>
              <th className="px-3 py-1.5">Producto</th>
              <th className="px-3 py-1.5">SKU</th>
              <th className="px-3 py-1.5">Código de barras</th>
              <th className="px-3 py-1.5">Categoría</th>
              <th className="px-3 py-1.5">Tipo</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {productsQuery.isLoading && <TableRowsSkeleton columns={7} />}
            {items.map((product) => (
              <tr key={product.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{product.code}</td>
                <td className="px-3 py-1">
                  <Link
                    href={`/productos/${product.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {product.name}
                  </Link>
                  {product.hasVariants && (
                    <p className="text-xs text-muted-foreground">
                      {product.variantCount} variante{product.variantCount === 1 ? '' : 's'}
                    </p>
                  )}
                </td>
                <td className="px-3 py-1 whitespace-nowrap">{product.primarySku ?? '—'}</td>
                <td className="px-3 py-1 whitespace-nowrap">{product.primaryBarcode ?? '—'}</td>
                <td className="px-3 py-1">{product.categoryName ?? '—'}</td>
                <td className="px-3 py-1">{productTypeLabel(product.productType)}</td>
                <td className="px-3 py-1">
                  <StatusBadge status={product.status}>
                    {product.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                  </StatusBadge>
                </td>
              </tr>
            ))}
            {productsQuery.isError && (
              <TableMessage
                columns={7}
                kind="error"
                title="No pudimos cargar los productos"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => productsQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!productsQuery.isLoading && !productsQuery.isError && items.length === 0 && !hasActiveFilters && (
              <TableMessage
                columns={7}
                title="Todavía no hay productos"
                description="Creá el primer producto para comenzar."
                action={canCreate && (
                    <Link href="/productos/nuevo" className={buttonVariants()}>
                      <Plus className="size-4" />
                      Nuevo producto
                    </Link>
                )}
              />
            )}
            {!productsQuery.isLoading && !productsQuery.isError && items.length === 0 && hasActiveFilters && (
              <TableMessage
                columns={7}
                kind="filtered"
                title="No encontramos productos"
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
          itemLabel={pagination.total === 1 ? 'producto' : 'productos'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
