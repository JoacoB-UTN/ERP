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
import { buttonVariants } from '@/components/ui/button';
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
    <div className="flex flex-col gap-6">
      <ProductosSubNav />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
          <p className="text-sm text-muted-foreground">Catálogo de productos y servicios de esta empresa.</p>
        </div>
        {canCreate && (
          <Link href="/productos/nuevo" className={buttonVariants()}>
            <Plus className="size-4" />
            Nuevo producto
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por nombre, código, SKU, código de barras…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-sm"
          aria-label="Buscar productos"
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
          <option value="ACTIVE">Activo</option>
          <option value="INACTIVE">Inactivo</option>
        </Select>
        <Select
          value={productType}
          onChange={(e) => {
            setProductType(e.target.value);
            setPage(1);
          }}
          className="max-w-44"
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
          className="max-w-52"
          aria-label="Categoría"
        >
          <option value="">Todas las categorías</option>
          {categoriesQuery.data?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Código de barras</th>
              <th className="px-4 py-2">Categoría</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((product) => (
              <tr key={product.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{product.code}</td>
                <td className="px-4 py-2">
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
                <td className="px-4 py-2 whitespace-nowrap">{product.primarySku ?? '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{product.primaryBarcode ?? '—'}</td>
                <td className="px-4 py-2">{product.categoryName ?? '—'}</td>
                <td className="px-4 py-2">{productTypeLabel(product.productType)}</td>
                <td className="px-4 py-2">
                  {product.status === 'ACTIVE' ? (
                    <span className="text-emerald-600">Activo</span>
                  ) : (
                    <span className="text-muted-foreground">Inactivo</span>
                  )}
                </td>
              </tr>
            ))}
            {!productsQuery.isLoading && items.length === 0 && !hasActiveFilters && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="text-muted-foreground">Todavía no hay productos.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Creá el primer producto para comenzar.</p>
                  {canCreate && (
                    <Link href="/productos/nuevo" className={`${buttonVariants()} mt-4`}>
                      <Plus className="size-4" />
                      Nuevo producto
                    </Link>
                  )}
                </td>
              </tr>
            )}
            {!productsQuery.isLoading && items.length === 0 && hasActiveFilters && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="text-muted-foreground">No encontramos productos con esos criterios.</p>
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
            Página {pagination.page} de {totalPages} — {pagination.total} producto
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
