'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AdjustmentType, adjustmentTypeLabel, formatMoney, type BulkAdjustPreviewResponse } from '@erp/shared';
import {
  usePermissions,
  usePriceList,
  useProductCategories,
  useBrands,
  usePreviewBulkAdjust,
  useConfirmBulkAdjust,
} from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { pricingErrorMessage } from '@/components/pricing/pricing-errors';

const ADJUSTMENT_TYPES = Object.values(AdjustmentType);
const SCOPES = ['ALL', 'CATEGORY', 'BRAND'] as const;
const SCOPE_LABELS: Record<(typeof SCOPES)[number], string> = {
  ALL: 'Todos los productos',
  CATEGORY: 'Una categoría',
  BRAND: 'Una marca',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ActualizacionMasivaPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const priceListQuery = usePriceList(id ?? null);
  const categoriesQuery = useProductCategories();
  const brandsQuery = useBrands();
  const previewBulkAdjust = usePreviewBulkAdjust();
  const confirmBulkAdjust = useConfirmBulkAdjust();

  const [scope, setScope] = useState<(typeof SCOPES)[number]>('ALL');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<string>(AdjustmentType.PERCENTAGE_INCREASE);
  const [value, setValue] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<BulkAdjustPreviewResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [confirmed, setConfirmed] = useState<number | null>(null);

  if (permissionsLoading || priceListQuery.isLoading) {
    return null;
  }
  const priceList = priceListQuery.data?.priceList;
  if (!can('pricing.prices.bulk_update') || !priceList) {
    return <Unauthorized />;
  }
  if (priceList.pricingMode !== 'FIXED') {
    return (
      <p className="text-sm text-muted-foreground">
        La actualización masiva solo está disponible para listas fijas — {priceList.name} es una lista derivada.
      </p>
    );
  }

  const currentKey = JSON.stringify({ scope, categoryId, brandId, adjustmentType, value, effectiveFrom });
  const previewIsStale = preview !== null && previewKey !== currentKey;

  function buildInput() {
    return {
      adjustmentType: adjustmentType as (typeof ADJUSTMENT_TYPES)[number],
      value,
      effectiveFrom: new Date(effectiveFrom),
      reason: reason || undefined,
      scope,
      categoryId: scope === 'CATEGORY' ? categoryId : undefined,
      brandId: scope === 'BRAND' ? brandId : undefined,
    };
  }

  async function handlePreview() {
    setError(undefined);
    setConfirmed(null);
    try {
      const result = await previewBulkAdjust.mutateAsync({ priceListId: priceList!.id, input: buildInput() });
      setPreview(result);
      setPreviewKey(currentKey);
    } catch (err) {
      setError(pricingErrorMessage(err));
    }
  }

  async function handleConfirm() {
    setError(undefined);
    try {
      const result = await confirmBulkAdjust.mutateAsync({ priceListId: priceList!.id, input: buildInput() });
      setConfirmed(result.affectedCount);
      setPreview(null);
      setPreviewKey(null);
    } catch (err) {
      setError(pricingErrorMessage(err));
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        href={`/listas-de-precios/${priceList.id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a {priceList.name}
      </Link>

      <PageHeader
        title="Actualización masiva de precios"
        description={`${priceList.name} (${priceList.currencyCode}). Revisá la vista previa antes de confirmar; ningún precio cambia antes.`}
      />

      <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scope">Alcance</Label>
            <Select
              id="scope"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as (typeof SCOPES)[number]);
                setPreview(null);
              }}
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          {scope === 'CATEGORY' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="categoryId">Categoría</Label>
              <Select id="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="">Elegí una categoría</option>
                {categoriesQuery.data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {scope === 'BRAND' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brandId">Marca</Label>
              <Select id="brandId" value={brandId} onChange={(e) => setBrandId(e.target.value)} required>
                <option value="">Elegí una marca</option>
                {brandsQuery.data?.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adjustmentType">Tipo de ajuste</Label>
            <Select id="adjustmentType" value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value)}>
              {ADJUSTMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {adjustmentTypeLabel(type)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="value">Valor</Label>
            <Input
              id="value"
              type="number"
              min="0"
              step="0.000001"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="effectiveFrom">Vigente desde</Label>
            <Input
              id="effectiveFrom"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason">Motivo (opcional)</Label>
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>

        <FieldError message={error} />

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePreview}
            disabled={
              previewBulkAdjust.isPending ||
              !value ||
              !effectiveFrom ||
              (scope === 'CATEGORY' && !categoryId) ||
              (scope === 'BRAND' && !brandId)
            }
          >
            {previewBulkAdjust.isPending ? 'Calculando…' : 'Vista previa'}
          </Button>
        </div>
      </div>

      {confirmed !== null && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30">
          Actualización aplicada: {confirmed} producto{confirmed === 1 ? '' : 's'} afectado{confirmed === 1 ? '' : 's'}.{' '}
          <Link href={`/listas-de-precios/${priceList.id}`} className="underline underline-offset-4">
            Volver a la lista
          </Link>
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {preview.affectedCount} producto{preview.affectedCount === 1 ? '' : 's'} afectado
              {preview.affectedCount === 1 ? '' : 's'}
            </h2>
            {previewIsStale && (
              <p className="text-sm text-amber-600">
                Cambiaste los parámetros — generá una nueva vista previa antes de confirmar.
              </p>
            )}
          </div>

          {preview.lines.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2">SKU</th>
                    <th className="px-4 py-2 text-right">Precio actual</th>
                    <th className="px-4 py-2 text-right">Precio nuevo</th>
                    <th className="px-4 py-2 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line) => {
                    const diff = Number(line.newPrice) - Number(line.currentPrice);
                    return (
                      <tr key={line.variantId} className="border-t border-border">
                        <td className="px-4 py-2 font-medium">
                          {line.productName}
                          {line.variantName && <p className="text-xs text-muted-foreground">{line.variantName}</p>}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{line.sku ?? '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMoney(line.currentPrice, priceList.currencyCode)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMoney(line.newPrice, priceList.currencyCode)}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${diff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {diff >= 0 ? '+' : ''}
                          {formatMoney(diff.toFixed(4), priceList.currencyCode)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={confirmBulkAdjust.isPending || previewIsStale || preview.affectedCount === 0}
            >
              {confirmBulkAdjust.isPending ? 'Confirmando…' : 'Confirmar actualización'}
            </Button>
            <Link href={`/listas-de-precios/${priceList.id}`} className={buttonVariants({ variant: 'outline' })}>
              Cancelar
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
