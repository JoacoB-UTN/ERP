'use client';

import { ScanBarcode, X } from 'lucide-react';
import { formatMoney } from '@erp/shared';
import type { SaleLineDraft } from '@/components/ventas/cart';
import { cn } from '@/lib/utils';

function previewLineTotal(quantity: string, unitPrice: string, discountPercentage: string): number | null {
  const qty = Number(quantity);
  const price = Number(unitPrice);
  const pct = Number(discountPercentage || '0');
  if (!Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(pct)) return null;
  const gross = qty * price;
  return gross - (gross * pct) / 100;
}

/**
 * The POS cart — denser than Facturación's regular sale table (docs/pos.md),
 * with an "active line" concept (`activeKey`) so quantity/discount/remove
 * keyboard shortcuts (+/-, Delete, F6) always have an unambiguous target.
 * Clicking a row makes it active; the workspace also sets a newly-added
 * line active automatically.
 */
export function PosCart({
  lines,
  priceMap,
  currencyCode,
  activeKey,
  onSetActive,
  onRemove,
}: {
  lines: SaleLineDraft[];
  priceMap: Record<string, string | null>;
  currencyCode: string | null;
  activeKey: string | null;
  onSetActive: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        <ScanBarcode className="size-8 text-muted-foreground/40" aria-hidden="true" />
        Escaneá un producto o buscá por nombre, SKU o código.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 text-left text-xs font-semibold text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-3 py-2.5">Producto</th>
            <th className="px-3 py-2.5 text-right">Cant.</th>
            <th className="px-3 py-2.5 text-right">Precio</th>
            <th className="px-3 py-2.5 text-right">Desc.</th>
            <th className="px-3 py-2.5 text-right">Total</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const price = priceMap[line.variantId];
            const isService = line.productType === 'SERVICE';
            const isActive = line.key === activeKey;
            const lineTotal =
              price !== null && price !== undefined ? previewLineTotal(line.quantity, price, line.discountPercentage) : null;
            return (
              <tr
                key={line.key}
                onClick={() => onSetActive(line.key)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'cursor-pointer border-t border-border transition-colors',
                  isActive ? 'bg-primary/[0.06]' : 'hover:bg-muted/50',
                )}
              >
                <td className={cn('py-3 pr-3 pl-3', isActive && 'border-l-2 border-l-primary pl-[0.6875rem]')}>
                  <p className={cn('leading-tight', isActive ? 'font-semibold' : 'font-medium')}>{line.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.sku ?? '—'}
                    {isService ? ' · Servicio' : ''}
                  </p>
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{line.quantity}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {price === undefined ? 'Cargando…' : price === null || !currencyCode ? '—' : formatMoney(price, currencyCode)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {Number(line.discountPercentage) > 0 ? `${line.discountPercentage}%` : '—'}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">
                  {lineTotal !== null && currencyCode ? formatMoney(String(lineTotal), currencyCode) : '—'}
                </td>
                <td className="px-3 py-3 text-right">
                  <button
                    type="button"
                    aria-label={`Quitar ${line.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(line.key);
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:bg-destructive-muted hover:text-destructive"
                  >
                    <X className="size-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
