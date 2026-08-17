'use client';

import { Search, X } from 'lucide-react';
import { formatMoney } from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface SaleLineDraft {
  key: string;
  variantId: string;
  label: string;
  sku: string | null;
  productType: string;
  quantity: string;
  discountPercentage: string;
}

export function toSaleLineInputs(
  lines: SaleLineDraft[],
): { productVariantId: string; quantity: string; discountPercentage: string }[] {
  return lines.map((l) => ({
    productVariantId: l.variantId,
    quantity: l.quantity,
    discountPercentage: l.discountPercentage || '0',
  }));
}

/** Client-side preview only — never floating-point authoritative business truth; the confirmed/saved sale's totals from the backend are canonical (see docs/sales.md and docs/facturacion.md). */
function previewLineTotal(quantity: string, unitPrice: string, discountPercentage: string): number | null {
  const qty = Number(quantity);
  const price = Number(unitPrice);
  const pct = Number(discountPercentage || '0');
  if (!Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(pct)) return null;
  const gross = qty * price;
  return gross - (gross * pct) / 100;
}

export function computeCartTotals(
  lines: SaleLineDraft[],
  priceMap: Record<string, string | null>,
): { subtotal: number; discountTotal: number; total: number; allPriced: boolean } {
  let subtotal = 0;
  let discountTotal = 0;
  let allPriced = true;
  for (const line of lines) {
    const price = priceMap[line.variantId];
    if (!price) {
      allPriced = false;
      continue;
    }
    const qty = Number(line.quantity) || 0;
    const pct = Number(line.discountPercentage || '0') || 0;
    const gross = qty * Number(price);
    const discount = (gross * pct) / 100;
    subtotal += gross - discount;
    discountTotal += discount;
  }
  return { subtotal, discountTotal, total: subtotal, allPriced };
}

/**
 * The sale-in-progress cart. Quantity/discount editing is free-form here
 * (no client-side unit-precision lookup exists for the search-result
 * shape, see docs/facturacion.md) — the backend independently rejects an
 * invalid precision with a clear message on save (INVALID_QUANTITY_PRECISION).
 * Price is never editable — it's always the resolved `priceMap` value, a
 * snapshot preview of what PricingService will actually charge.
 */
export function SaleLinesTable({
  lines,
  priceMap,
  currencyCode,
  readOnly,
  onChange,
  onRemove,
}: {
  lines: SaleLineDraft[];
  priceMap: Record<string, string | null>;
  currencyCode: string | null;
  readOnly?: boolean;
  onChange: (key: string, patch: Partial<SaleLineDraft>) => void;
  onRemove: (key: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="flex min-h-56 flex-1 flex-col items-center justify-center rounded-md border border-dashed border-border bg-card/40 p-10 text-center">
        <Search className="mb-3 size-5 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">La venta todavía no tiene productos</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Buscá por nombre, SKU o código de barras para agregar la primera línea.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[50rem] text-sm">
        <thead className="bg-muted/60 text-left text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="h-10 px-3">Producto</th>
            <th className="h-10 px-3 text-right">Cantidad</th>
            <th className="h-10 px-3 text-right">Precio unit.</th>
            <th className="h-10 px-3 text-right">Desc. %</th>
            <th className="h-10 px-3 text-right">Subtotal</th>
            {!readOnly && (
              <th className="h-10 w-10 px-3">
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const price = priceMap[line.variantId];
            const isService = line.productType === 'SERVICE';
            const lineTotal =
              price !== null && price !== undefined
                ? previewLineTotal(line.quantity, price, line.discountPercentage)
                : null;
            return (
              <tr
                key={line.key}
                className="border-t border-border transition-colors hover:bg-muted/35 focus-within:bg-accent/40"
              >
                <td className="h-14 px-3 py-2">
                  <p className="font-medium">{line.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.sku ?? '—'}
                    {isService ? ' · Servicio' : ''}
                  </p>
                </td>
                <td className="h-14 px-3 py-2 text-right">
                  {readOnly ? (
                    <span className="tabular-nums">{line.quantity}</span>
                  ) : (
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={line.quantity}
                      onChange={(e) => onChange(line.key, { quantity: e.target.value })}
                      className="ml-auto w-20 border-transparent bg-transparent text-right hover:border-input focus-visible:border-ring"
                      aria-label={`Cantidad de ${line.label}`}
                    />
                  )}
                </td>
                <td className="h-14 px-3 py-2 text-right tabular-nums">
                  {price === undefined ? (
                    'Cargando…'
                  ) : price === null || !currencyCode ? (
                    <span className="rounded bg-destructive-muted px-1.5 py-0.5 text-xs font-medium text-destructive">
                      Sin precio
                    </span>
                  ) : (
                    formatMoney(price, currencyCode)
                  )}
                </td>
                <td className="h-14 px-3 py-2 text-right">
                  {readOnly ? (
                    <span className="tabular-nums">{line.discountPercentage}%</span>
                  ) : (
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      value={line.discountPercentage}
                      onChange={(e) => onChange(line.key, { discountPercentage: e.target.value })}
                      className="ml-auto w-16 border-transparent bg-transparent text-right hover:border-input focus-visible:border-ring"
                      aria-label={`Descuento de ${line.label}`}
                    />
                  )}
                </td>
                <td className="h-14 px-3 py-2 text-right font-semibold tabular-nums">
                  {lineTotal !== null && currencyCode ? formatMoney(String(lineTotal), currencyCode) : '—'}
                </td>
                {!readOnly && (
                  <td className="h-14 px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Quitar ${line.label}`}
                      onClick={() => onRemove(line.key)}
                    >
                      <X className="size-4" />
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SaleTotals({
  subtotal,
  discountTotal,
  total,
  currencyCode,
}: {
  subtotal: number;
  discountTotal: number;
  total: number;
  currencyCode: string | null;
}) {
  // Matches the backend's documented convention (docs/sales.md): `subtotal`
  // is already NET of line discounts, and `total = subtotal + taxTotal`
  // (taxTotal always 0 today) — so Subtotal and Total show the same
  // figure here, exactly as Gestión's own sale detail does.
  const fmt = (n: number) => (currencyCode ? formatMoney(String(n), currencyCode) : '—');
  return (
    <div className="flex flex-wrap items-end justify-end gap-x-6 gap-y-2 text-sm">
      <div className="grid min-w-52 grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="text-right tabular-nums">{fmt(subtotal)}</span>
        <span className="text-muted-foreground">Descuentos</span>
        <span className="text-right tabular-nums">{fmt(discountTotal)}</span>
        <span className="text-muted-foreground">Impuestos</span>
        <span className="text-right tabular-nums">{fmt(0)}</span>
      </div>
      <div className="min-w-48 border-l border-border pl-5 text-right">
        <span className="block text-xs font-medium text-muted-foreground">Total {currencyCode ?? ''}</span>
        <span className="block text-2xl leading-8 font-bold tracking-tight tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  );
}
