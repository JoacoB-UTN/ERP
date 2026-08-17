'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Trash2, Plus, Power } from 'lucide-react';
import {
  productTypeLabel,
  productCodeTypeLabel,
  formatDecimalDisplay,
  formatMoney,
  type ProductDetail,
  type ProductVariantDto,
  type ProductCodeDto,
  type ProductCodeInput,
} from '@erp/shared';
import {
  usePermissions,
  useProduct,
  useProductHistory,
  useProductStock,
  useProductPrices,
  useDeactivateProduct,
  useReactivateProduct,
  useAddProductVariant,
  useUpdateProductVariant,
  useDeactivateProductVariant,
  useReactivateProductVariant,
  useAddProductCode,
  useUpdateProductCode,
  useRemoveProductCode,
} from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Unauthorized } from '@/components/layout/unauthorized';
import { CodeCard } from '@/components/productos/code-card';
import { ProductHistoryItem } from '@/components/productos/product-history-item';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

type TabKey = 'resumen' | 'variantes' | 'stock' | 'precios' | 'configuracion' | 'historial';

export default function ProductoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const productQuery = useProduct(id ?? null);

  if (permissionsLoading || productQuery.isLoading) {
    return null;
  }
  if (!can('products.read') || !productQuery.data) {
    return <Unauthorized />;
  }

  return (
    <ProductoDetailView
      product={productQuery.data.product}
      canUpdate={can('products.update')}
      canDeactivate={can('products.deactivate')}
      canSeeStock={can('inventory.stock.read')}
      canSeePrices={can('pricing.prices.read')}
    />
  );
}

function ProductoDetailView({
  product,
  canUpdate,
  canDeactivate,
  canSeeStock,
  canSeePrices,
}: {
  product: ProductDetail;
  canUpdate: boolean;
  canDeactivate: boolean;
  canSeeStock: boolean;
  canSeePrices: boolean;
}) {
  const [tab, setTab] = useState<TabKey>('resumen');
  const deactivate = useDeactivateProduct();
  const reactivate = useReactivateProduct();

  async function handleToggleStatus() {
    if (product.status === 'ACTIVE') {
      if (!window.confirm(`¿Desactivar el producto "${product.name}"?`)) return;
      await deactivate.mutateAsync(product.id);
    } else {
      await reactivate.mutateAsync(product.id);
    }
  }

  const showStockTab = canSeeStock && product.trackInventory;

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'resumen', label: 'Resumen' },
    { key: 'variantes', label: product.hasVariants ? `Variantes y códigos (${product.variantCount})` : 'Variantes y códigos' },
    ...(showStockTab ? [{ key: 'stock' as const, label: 'Stock' }] : []),
    ...(canSeePrices ? [{ key: 'precios' as const, label: 'Precios' }] : []),
    { key: 'configuracion', label: 'Configuración' },
    { key: 'historial', label: 'Historial' },
  ];

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{product.name}<StatusBadge status={product.status}>{product.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</StatusBadge></span>}
        description={`${product.code} · ${productTypeLabel(product.productType)}`}
        backHref="/productos"
        backLabel="Productos"
        actions={<>
          {canUpdate && (
            <Link href={`/productos/${product.id}/editar`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil className="size-4" />
              Editar
            </Link>
          )}
          {canDeactivate && (
            <Button
              type="button"
              variant={product.status === 'ACTIVE' ? 'destructive' : 'outline'}
              onClick={handleToggleStatus}
              disabled={deactivate.isPending || reactivate.isPending}
            >
              <Power className="size-4" />
              {product.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}
            </Button>
          )}
        </>}
      />

      <div role="tablist" aria-label="Secciones del producto" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.key
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <ResumenTab product={product} onGoToVariants={() => setTab('variantes')} />}
      {tab === 'variantes' && <VariantesTab product={product} canUpdate={canUpdate} />}
      {tab === 'stock' && showStockTab && <StockTab productId={product.id} />}
      {tab === 'precios' && canSeePrices && <PreciosTab productId={product.id} />}
      {tab === 'configuracion' && <ConfiguracionTab product={product} />}
      {tab === 'historial' && <HistorialTab productId={product.id} />}
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? '—'}</dd>
    </div>
  );
}

function ResumenTab({ product, onGoToVariants }: { product: ProductDetail; onGoToVariants: () => void }) {
  return (
    <dl className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
      <SummaryField label="Tipo" value={productTypeLabel(product.productType)} />
      <SummaryField label="Categoría" value={product.categoryName} />
      <SummaryField label="Marca" value={product.brandName} />
      <SummaryField label="Unidad" value={`${product.baseUnit.name} (${product.baseUnit.symbol})`} />
      {product.description && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Descripción</dt>
          <dd className="text-sm whitespace-pre-wrap">{product.description}</dd>
        </div>
      )}
      {!product.hasVariants ? (
        <>
          <SummaryField label="SKU" value={product.primarySku} />
          <SummaryField label="Código de barras" value={product.primaryBarcode} />
        </>
      ) : (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Variantes</dt>
          <dd className="text-sm">
            {product.variantCount} variantes —{' '}
            <button type="button" onClick={onGoToVariants} className="underline-offset-4 hover:underline">
              ver detalle
            </button>
          </dd>
        </div>
      )}
      {product.notes && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Notas</dt>
          <dd className="text-sm whitespace-pre-wrap">{product.notes}</dd>
        </div>
      )}
    </dl>
  );
}

function ConfiguracionTab({ product }: { product: ProductDetail }) {
  const yesNo = (v: boolean) => (v ? 'Sí' : 'No');
  return (
    <dl className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
      <SummaryField label="Controla stock" value={yesNo(product.trackInventory)} />
      <SummaryField label="Permite stock negativo" value={yesNo(product.allowNegativeStock)} />
      <SummaryField label="Control por lote" value={yesNo(product.trackLots)} />
      <SummaryField label="Control por número de serie" value={yesNo(product.trackSerials)} />
      <SummaryField label="Stock mínimo" value={product.minimumStock ? formatDecimalDisplay(product.minimumStock) : null} />
      <SummaryField label="Stock máximo" value={product.maximumStock ? formatDecimalDisplay(product.maximumStock) : null} />
      <SummaryField label="Punto de reposición" value={product.reorderPoint ? formatDecimalDisplay(product.reorderPoint) : null} />
    </dl>
  );
}

function emptyCodeDraft(): ProductCodeInput {
  return { type: 'BARCODE', code: '' };
}

/** Manages the codes (barcode/alternate codes) belonging to ONE variant. */
function VariantCodesEditor({
  productId,
  variant,
  canUpdate,
}: {
  productId: string;
  variant: ProductVariantDto;
  canUpdate: boolean;
}) {
  const addCode = useAddProductCode();
  const updateCode = useUpdateProductCode();
  const removeCode = useRemoveProductCode();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<ProductCodeInput | null>(null);

  function startNew() {
    setEditingId('new');
    setDraft(emptyCodeDraft());
  }
  function startEdit(code: ProductCodeDto) {
    setEditingId(code.id);
    setDraft({ type: code.type, code: code.code, description: code.description ?? undefined });
  }
  function cancel() {
    setEditingId(null);
    setDraft(null);
  }
  async function save() {
    if (!draft) return;
    if (editingId === 'new') {
      await addCode.mutateAsync({ productId, variantId: variant.id, input: draft });
    } else if (editingId) {
      await updateCode.mutateAsync({ productId, variantId: variant.id, codeId: editingId, input: draft });
    }
    cancel();
  }
  async function remove(codeId: string) {
    if (!window.confirm('¿Eliminar este código?')) return;
    await removeCode.mutateAsync({ productId, variantId: variant.id, codeId });
  }

  return (
    <div className="flex flex-col gap-2">
      {variant.codes.map((code) =>
        editingId === code.id && draft ? (
          <div key={code.id} className="flex flex-col gap-2">
            <CodeCard value={draft} onChange={setDraft} onRemove={cancel} />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={updateCode.isPending}>
                Guardar
              </Button>
              <Button size="sm" variant="outline" onClick={cancel}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div key={code.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">
                {productCodeTypeLabel(code.type)}: {code.code}
                {!code.active && <span className="ml-1.5 text-xs text-muted-foreground">(inactivo)</span>}
              </p>
              {code.description && <p className="text-xs text-muted-foreground">{code.description}</p>}
            </div>
            {canUpdate && (
              <div className="flex gap-1">
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => startEdit(code)}>
                  <Pencil className="size-4" />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => remove(code.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </div>
        ),
      )}
      {editingId === 'new' && draft && (
        <div className="flex flex-col gap-2">
          <CodeCard value={draft} onChange={setDraft} onRemove={cancel} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={addCode.isPending}>
              Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={cancel}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {variant.codes.length === 0 && editingId !== 'new' && (
        <p className="text-sm text-muted-foreground">Sin códigos registrados.</p>
      )}
      {canUpdate && editingId !== 'new' && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={startNew}>
          <Plus className="size-4" />
          Agregar código
        </Button>
      )}
    </div>
  );
}

/** One explicit variant — name/SKU inline edit, active toggle, and its own codes. */
function VariantRow({ productId, variant, canUpdate }: { productId: string; variant: ProductVariantDto; canUpdate: boolean }) {
  const updateVariant = useUpdateProductVariant();
  const deactivateVariant = useDeactivateProductVariant();
  const reactivateVariant = useReactivateProductVariant();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(variant.name ?? '');
  const [sku, setSku] = useState(variant.sku ?? '');

  async function save() {
    await updateVariant.mutateAsync({ productId, variantId: variant.id, input: { name, sku: sku || null } });
    setEditing(false);
  }
  async function toggleActive() {
    if (variant.active) {
      await deactivateVariant.mutateAsync({ productId, variantId: variant.id });
    } else {
      await reactivateVariant.mutateAsync({ productId, variantId: variant.id });
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Nombre</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium">
              {variant.name ?? 'Variante principal'}
              {!variant.active && <span className="ml-1.5 text-xs text-muted-foreground">(inactiva)</span>}
            </p>
            <p className="text-sm text-muted-foreground">SKU: {variant.sku ?? '—'}</p>
            {variant.attributes && Object.keys(variant.attributes).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(variant.attributes).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {canUpdate && (
          <div className="flex shrink-0 gap-1">
            {editing ? (
              <>
                <Button size="sm" onClick={save} disabled={updateVariant.isPending}>
                  Guardar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" />
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={toggleActive}>
                  {variant.active ? 'Desactivar' : 'Reactivar'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <VariantCodesEditor productId={productId} variant={variant} canUpdate={canUpdate} />
    </div>
  );
}

function VariantesTab({ product, canUpdate }: { product: ProductDetail; canUpdate: boolean }) {
  const addVariant = useAddProductVariant();
  const [addingVariant, setAddingVariant] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSku, setNewSku] = useState('');

  async function saveNewVariant() {
    await addVariant.mutateAsync({ productId: product.id, input: { name: newName, sku: newSku || undefined, codes: [] } });
    setAddingVariant(false);
    setNewName('');
    setNewSku('');
  }

  if (!product.hasVariants) {
    const variant = product.variants[0];
    return (
      <div className="flex flex-col gap-4">
        <SimpleVariantSkuEditor productId={product.id} variant={variant} canUpdate={canUpdate} />
        <div>
          <Label>Códigos</Label>
          <div className="mt-2">
            <VariantCodesEditor productId={product.id} variant={variant} canUpdate={canUpdate} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {product.variants.map((variant) => (
        <VariantRow key={variant.id} productId={product.id} variant={variant} canUpdate={canUpdate} />
      ))}
      {addingVariant ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Nombre</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Negro / M" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>SKU</Label>
              <Input value={newSku} onChange={(e) => setNewSku(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveNewVariant} disabled={addVariant.isPending || !newName}>
              Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddingVariant(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        canUpdate && (
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setAddingVariant(true)}>
            <Plus className="size-4" />
            Agregar variante
          </Button>
        )
      )}
    </div>
  );
}

/** SKU-only inline editor for the auto-created default variant of a simple product — no "variant" framing in the UI (see docs/products.md). */
function SimpleVariantSkuEditor({
  productId,
  variant,
  canUpdate,
}: {
  productId: string;
  variant: ProductVariantDto;
  canUpdate: boolean;
}) {
  const updateVariant = useUpdateProductVariant();
  const [editing, setEditing] = useState(false);
  const [sku, setSku] = useState(variant.sku ?? '');

  async function save() {
    await updateVariant.mutateAsync({ productId, variantId: variant.id, input: { sku: sku || null } });
    setEditing(false);
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label>SKU</Label>
        {editing ? (
          <Input value={sku} onChange={(e) => setSku(e.target.value)} className="max-w-60" autoFocus />
        ) : (
          <p className="text-sm">{variant.sku ?? '—'}</p>
        )}
      </div>
      {canUpdate &&
        (editing ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={updateVariant.isPending}>
              Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
          </Button>
        ))}
    </div>
  );
}

function qty(value: string): string {
  return formatDecimalDisplay(value, 6) ?? value;
}

/** Read-only — Físico/Reservado/Disponible per warehouse, never editable from here (see docs/inventory.md). */
function StockTab({ productId }: { productId: string }) {
  const stockQuery = useProductStock(productId);
  const data = stockQuery.data;

  if (stockQuery.isLoading) {
    return null;
  }
  if (!data || data.variants.every((v) => v.warehouses.length === 0)) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay movimientos de inventario para este producto en ningún depósito.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.variants.map((variant) => (
        <div key={variant.variantId}>
          {data.variants.length > 1 && (
            <p className="mb-2 text-sm font-medium">{variant.variantName ?? 'Variante principal'}</p>
          )}
          {variant.warehouses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos en ningún depósito.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Depósito</th>
                    <th className="px-4 py-2 text-right">Físico</th>
                    <th className="px-4 py-2 text-right">Reservado</th>
                    <th className="px-4 py-2 text-right">Disponible</th>
                  </tr>
                </thead>
                <tbody>
                  {variant.warehouses.map((w) => {
                    const onHand = Number(w.onHand);
                    const available = Number(w.available);
                    return (
                      <tr key={w.warehouseId} className="border-t border-border">
                        <td className="px-4 py-2 whitespace-nowrap">{w.warehouseName}</td>
                        <td className={`px-4 py-2 text-right tabular-nums ${onHand < 0 ? 'text-red-600' : ''}`}>
                          {qty(w.onHand)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{qty(w.reserved)}</td>
                        <td className={`px-4 py-2 text-right tabular-nums ${available < 0 ? 'text-red-600' : ''}`}>
                          {qty(w.available)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Current price per active PriceList, resolved via PricingService (never a
 * price stored on Product/ProductVariant — see CLAUDE.md). `price === null`
 * always renders "Sin precio", never a fabricated "$0" (see docs/pricing.md).
 * No stock/cost/margin shown here — that's a separate concern.
 */
function PreciosTab({ productId }: { productId: string }) {
  const pricesQuery = useProductPrices(productId);
  const data = pricesQuery.data;

  if (pricesQuery.isLoading) {
    return null;
  }
  if (!data || data.variants.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay listas de precios activas en esta empresa.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {data.variants.map((variant) => (
        <div key={variant.variantId}>
          {data.variants.length > 1 && (
            <p className="mb-2 text-sm font-medium">{variant.variantName ?? 'Variante principal'}</p>
          )}
          {variant.prices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay listas de precios activas.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Lista de precios</th>
                    <th className="px-4 py-2 text-right">Precio</th>
                    <th className="px-4 py-2">Vigente desde</th>
                  </tr>
                </thead>
                <tbody>
                  {variant.prices.map((p) => (
                    <tr key={p.priceListId} className="border-t border-border">
                      <td className="px-4 py-2">
                        <Link href={`/listas-de-precios/${p.priceListId}`} className="font-medium underline-offset-4 hover:underline">
                          {p.priceListName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{p.priceListCode}</p>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {p.price !== null ? (
                          formatMoney(p.price, p.currencyCode)
                        ) : (
                          <span className="text-muted-foreground">Sin precio</span>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{p.effectiveFrom ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HistorialTab({ productId }: { productId: string }) {
  const historyQuery = useProductHistory(productId);
  const items = historyQuery.data?.items ?? [];

  if (historyQuery.isLoading) {
    return null;
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay eventos registrados para este producto.</p>;
  }
  return (
    <div className="rounded-xl border border-border px-4">
      {items.map((item) => (
        <ProductHistoryItem key={item.id} item={item} />
      ))}
    </div>
  );
}
