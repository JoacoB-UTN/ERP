'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  ProductType,
  productTypeLabel,
  type ProductVariantCreateInput,
  type ProductCodeInput,
} from '@erp/shared';
import {
  usePermissions,
  useCreateProduct,
  useProductCategories,
  useBrands,
  useUnits,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Unauthorized } from '@/components/layout/unauthorized';
import { FormSection, FieldError } from '@/components/ui/form-section';
import { CodeCard } from '@/components/productos/code-card';
import { VariantCard } from '@/components/productos/variant-card';
import { productFieldErrors } from '@/components/productos/form-errors';

function emptyCode(): ProductCodeInput {
  return { type: 'BARCODE', code: '' };
}
function emptyVariant(): ProductVariantCreateInput {
  return { name: '', codes: [] };
}

export default function NuevoProductoPage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const createProduct = useCreateProduct();
  const categoriesQuery = useProductCategories();
  const brandsQuery = useBrands();
  const unitsQuery = useUnits();

  const [productType, setProductType] = useState<string>('PRODUCT');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [baseUnitId, setBaseUnitId] = useState('');

  const [trackInventory, setTrackInventory] = useState(true);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [minimumStock, setMinimumStock] = useState('');
  const [maximumStock, setMaximumStock] = useState('');
  const [reorderPoint, setReorderPoint] = useState('');
  const [trackLots, setTrackLots] = useState(false);
  const [trackSerials, setTrackSerials] = useState(false);

  const [hasVariants, setHasVariants] = useState(false);
  const [sku, setSku] = useState('');
  const [codes, setCodes] = useState<ProductCodeInput[]>([]);
  const [variants, setVariants] = useState<ProductVariantCreateInput[]>([]);

  const [notes, setNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ general?: string; sku?: string; barcode?: string }>({});

  const isService = productType === 'SERVICE';

  // Fast path: preselect "Unidad" once units load, so the common case never requires a choice.
  // Derived at render time (no effect) — see CLAUDE.md's preference for handling this in the
  // event that caused it rather than reacting to it afterward.
  const defaultUnitId = unitsQuery.data?.units.find((u) => u.code === 'UN')?.id;
  const effectiveBaseUnitId = baseUnitId || defaultUnitId || '';

  // A service should not accidentally participate in physical inventory (see CLAUDE.md) —
  // reset synchronously when the user picks "Servicio", not via an effect reacting to it.
  function handleProductTypeChange(value: string) {
    setProductType(value);
    if (value === 'SERVICE') {
      setTrackInventory(false);
      setTrackLots(false);
      setTrackSerials(false);
    }
  }

  if (permissionsLoading) {
    return null;
  }
  if (!can('products.create')) {
    return <Unauthorized />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    try {
      const result = await createProduct.mutateAsync({
        code: code || undefined,
        name,
        description: description || undefined,
        productType: productType as ProductType,
        categoryId: categoryId || undefined,
        brandId: brandId || undefined,
        baseUnitId: effectiveBaseUnitId,
        trackInventory,
        trackLots,
        trackSerials,
        allowNegativeStock,
        minimumStock: minimumStock || null,
        maximumStock: maximumStock || null,
        reorderPoint: reorderPoint || null,
        notes: notes || undefined,
        sku: hasVariants ? undefined : sku || undefined,
        codes: hasVariants ? [] : codes,
        variants: hasVariants ? variants : [],
      });
      router.push(`/productos/${result.product.id}`);
    } catch (err) {
      setFieldErrors(productFieldErrors(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nuevo producto</h1>
        <p className="text-sm text-muted-foreground">
          Completá los datos principales. El resto se puede agregar después.
        </p>
      </div>

      <FormSection title="Datos principales" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productType">Tipo</Label>
            <Select id="productType" value={productType} onChange={(e) => handleProductTypeChange(e.target.value)}>
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
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Código</Label>
            <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Automático" />
          </div>
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
      </FormSection>

      <FormSection title="Clasificación" description="Categoría, marca y unidad de medida">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="categoryId">Categoría</Label>
            <Select id="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categoriesQuery.data?.categories.map((c) => (
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
              {brandsQuery.data?.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="baseUnitId">Unidad</Label>
            <Select id="baseUnitId" value={effectiveBaseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} required>
              <option value="">Elegir…</option>
              {unitsQuery.data?.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </FormSection>

      {!isService && (
        <FormSection title="Inventario" description="Configuración de control de stock — no cantidades">
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
                <input
                  type="checkbox"
                  checked={trackLots}
                  onChange={(e) => setTrackLots(e.target.checked)}
                />
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

      <FormSection title="Variantes y códigos" description="SKU, código de barras y variantes del producto">
        <div className="flex flex-col gap-1.5">
          <Label>¿Este producto tiene variantes?</Label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!hasVariants} onChange={() => setHasVariants(false)} />
              No
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={hasVariants} onChange={() => setHasVariants(true)} />
              Sí
            </label>
          </div>
        </div>

        {!hasVariants ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sku">SKU</Label>
              <Input
                id="sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                aria-invalid={!!fieldErrors.sku}
              />
              <FieldError message={fieldErrors.sku} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Códigos</Label>
              {fieldErrors.barcode && <FieldError message={fieldErrors.barcode} />}
              {codes.map((c, index) => (
                <CodeCard
                  key={index}
                  value={c}
                  onChange={(next) => setCodes((prev) => prev.map((x, i) => (i === index ? next : x)))}
                  onRemove={() => setCodes((prev) => prev.filter((_, i) => i !== index))}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setCodes((prev) => [...prev, emptyCode()])}
              >
                <Plus className="size-4" />
                Agregar código
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {variants.map((variant, index) => (
              <VariantCard
                key={index}
                value={variant}
                onChange={(next) => setVariants((prev) => prev.map((v, i) => (i === index ? next : v)))}
                onRemove={() => setVariants((prev) => prev.filter((_, i) => i !== index))}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setVariants((prev) => [...prev, emptyVariant()])}
            >
              <Plus className="size-4" />
              Agregar variante
            </Button>
          </div>
        )}
      </FormSection>

      <FormSection title="Notas">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observaciones internas sobre este producto…"
          rows={3}
        />
      </FormSection>

      {fieldErrors.general && (
        <p role="alert" className="text-sm text-destructive">
          {fieldErrors.general}
        </p>
      )}

      <div>
        <Button type="submit" disabled={createProduct.isPending || !effectiveBaseUnitId}>
          {createProduct.isPending ? 'Creando…' : 'Crear producto'}
        </Button>
      </div>
    </form>
  );
}
