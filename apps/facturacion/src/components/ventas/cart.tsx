'use client';

import { X } from 'lucide-react';
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
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Buscá un producto por nombre, SKU o código de barras.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Producto</th>
            <th className="px-3 py-2 text-right">Cantidad</th>
            <th className="px-3 py-2 text-right">Precio unit.</th>
            <th className="px-3 py-2 text-right">Desc. %</th>
            <th className="px-3 py-2 text-right">Subtotal</th>
            {!readOnly && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const price = priceMap[line.variantId];
            const isService = line.productType === 'SERVICE';
            const lineTotal = price !== null && price !== undefined ? previewLineTotal(line.quantity, price, line.discountPercentage) : null;
            return (
              <tr key={line.key} className="border-t border-border">
                <td className="px-3 py-2">
                  <p className="font-medium">{line.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.sku ?? '—'}
                    {isService ? ' · Servicio' : ''}
                  </p>
                </td>
                <td className="px-3 py-2 text-right">
                  {readOnly ? (
                    <span className="tabular-nums">{line.quantity}</span>
                  ) : (
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={line.quantity}
                      onChange={(e) => onChange(line.key, { quantity: e.target.value })}
                      className="ml-auto w-20 text-right"
                      aria-label={`Cantidad de ${line.label}`}
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {price === undefined
                    ? 'Cargando…'
                    : price === null || !currencyCode
                      ? <span className="text-destructive">Sin precio</span>
                      : formatMoney(price, currencyCode)}
                </td>
                <td className="px-3 py-2 text-right">
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
                      className="ml-auto w-16 text-right"
                      aria-label={`Descuento de ${line.label}`}
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {lineTotal !== null && currencyCode ? formatMoney(String(lineTotal), currencyCode) : '—'}
                </td>
                {!readOnly && (
                  <td className="px-3 py-2 text-right">
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
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="tabular-nums">{fmt(subtotal)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Descuentos</span>
        <span className="tabular-nums">{fmt(discountTotal)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Impuestos</span>
        <span className="tabular-nums">{fmt(0)}</span>
      </div>
      <div className="flex justify-between border-t border-border pt-1 text-lg font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  );
}
