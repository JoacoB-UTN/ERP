'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ProductType,
  productTypeLabel,
  type ProductDetail,
  type ProductCategoryDto,
  type BrandDto,
  type UnitOfMeasureDto,
} from '@erp/shared';
import {
  usePermissions,
  useProduct,
  useUpdateProduct,
  useProductCategories,
  useBrands,
  useUnits,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { FormSection } from '@/components/ui/form-section';
import { productFieldErrors } from '@/components/productos/form-errors';

export default function EditarProductoPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const productQuery = useProduct(id ?? null);
  const categoriesQuery = useProductCategories();
  const brandsQuery = useBrands();
  const unitsQuery = useUnits();

  if (
    permissionsLoading ||
    productQuery.isLoading ||
    categoriesQuery.isLoading ||
    brandsQuery.isLoading ||
    unitsQuery.isLoading
  ) {
    return null;
  }
  if (!can('products.update') || !productQuery.data) {
    return <Unauthorized />;
  }

  return (
    <EditarProductoForm
      key={productQuery.data.product.id}
      product={productQuery.data.product}
      categories={categoriesQuery.data?.categories ?? []}
      brands={brandsQuery.data?.brands ?? []}
      units={unitsQuery.data?.units ?? []}
    />
  );
}

function EditarProductoForm({
  product,
  categories,
  brands,
  units,
}: {
  product: ProductDetail;
  categories: ProductCategoryDto[];
  brands: BrandDto[];
  units: UnitOfMeasureDto[];
}) {
  const router = useRouter();
  const updateProduct = useUpdateProduct();

  const [productType, setProductType] = useState(product.productType);
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [categoryId, setCategoryId] = useState(product.categoryId ?? '');
  const [brandId, setBrandId] = useState(product.brandId ?? '');
  const [baseUnitId, setBaseUnitId] = useState(product.baseUnit.id);

  const [trackInventory, setTrackInventory] = useState(product.trackInventory);
  const [allowNegativeStock, setAllowNegativeStock] = useState(product.allowNegativeStock);
  const [minimumStock, setMinimumStock] = useState(product.minimumStock ?? '');
  const [maximumStock, setMaximumStock] = useState(product.maximumStock ?? '');
  const [reorderPoint, setReorderPoint] = useState(product.reorderPoint ?? '');
  const [trackLots, setTrackLots] = useState(product.trackLots);
  const [trackSerials, setTrackSerials] = useState(product.trackSerials);

  const [notes, setNotes] = useState(product.notes ?? '');
  const [fieldErrors, setFieldErrors] = useState<{ general?: string }>({});

  const isService = productType === 'SERVICE';

  // A service should not accidentally participate in physical inventory (see CLAUDE.md) —
  // reset synchronously when the user picks "Servicio", not via an effect reacting to it.
  function handleProductTypeChange(value: typeof productType) {
    setProductType(value);
    if (value === 'SERVICE') {
      setTrackInventory(false);
      setTrackLots(false);
      setTrackSerials(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    try {
      await updateProduct.mutateAsync({
        id: product.id,
        input: {
          productType,
          name,
          description: description || null,
          categoryId: categoryId || null,
          brandId: brandId || null,
          baseUnitId,
          trackInventory,
          trackLots,
          trackSerials,
          allowNegativeStock,
          minimumStock: minimumStock || null,
          maximumStock: maximumStock || null,
          reorderPoint: reorderPoint || null,
          notes: notes || null,
        },
      });
      router.push(`/productos/${product.id}`);
    } catch (err) {
      setFieldErrors(productFieldErrors(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      <PageHeader
        title="Editar producto"
        description={`${product.code} · ${product.name}`}
        backHref={`/productos/${product.id}`}
        backLabel="Volver al producto"
      />

      <FormSection title="Datos principales" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productType">Tipo</Label>
            <Select
              id="productType"
              value={productType}
              onChange={(e) => handleProductTypeChange(e.target.value as typeof productType)}
            >
              {Object.values(ProductType).map((value) => (
                <option key={value} value={value}>
                  {productTypeLabel(value)}
                </option>
              ))}
            </Select>
          </div>
          <div />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
      </FormSection>

      <FormSection title="Clasificación" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="categoryId">Categoría</Label>
            <Select id="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brandId">Marca</Label>
            <Select id="brandId" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">Sin marca</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="baseUnitId">Unidad</Label>
            <Select id="baseUnitId" value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </FormSection>

      {!isService && (
        <FormSection title="Inventario" description="Configuración de control de stock — no cantidades" defaultOpen>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={trackInventory}
              onChange={(e) => {
                setTrackInventory(e.target.checked);
                if (!e.target.checked) {
                  setTrackLots(false);
                  setTrackSerials(false);
                }
              }}
            />
            Controla stock
          </label>
          {trackInventory && (
            <div className="flex flex-col gap-4 border-l-2 border-border pl-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowNegativeStock}
                  onChange={(e) => setAllowNegativeStock(e.target.checked)}
                />
                Permitir stock negativo
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="minimumStock">Stock mínimo</Label>
                  <Input
                    id="minimumStock"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={minimumStock}
                    onChange={(e) => setMinimumStock(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maximumStock">Stock máximo</Label>
                  <Input
                    id="maximumStock"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={maximumStock}
                    onChange={(e) => setMaximumStock(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reorderPoint">Punto de reposición</Label>
                  <Input
                    id="reorderPoint"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={reorderPoint}
                    onChange={(e) => setReorderPoint(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={trackLots} onChange={(e) => setTrackLots(e.target.checked)} />
                Control por lote
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={trackSerials}
                  onChange={(e) => setTrackSerials(e.target.checked)}
                />
                Control por número de serie
              </label>
            </div>
          )}
        </FormSection>
      )}

      <FormSection title="Notas">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </FormSection>

      {fieldErrors.general && (
        <p role="alert" className="text-sm text-destructive">
          {fieldErrors.general}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={updateProduct.isPending}>
          {updateProduct.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/productos/${product.id}`)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
