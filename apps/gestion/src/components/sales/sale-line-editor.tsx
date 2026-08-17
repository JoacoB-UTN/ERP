'use client';

import { X } from 'lucide-react';
import { formatMoney } from '@erp/shared';
import { usePriceLookup, useVariantStock } from '@/lib/auth-client';
import { VariantPicker, type VariantPickerSelection } from '@/components/stock/variant-picker';

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

const inputClassName =
  'h-(--control-height) min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

/**
 * One sale line: quantity/discount are editable here, but unit price is
 * NEVER entered by hand — it's resolved live from PricingService for the
 * active priceListId (see docs/sales.md: the server always re-derives the
 * authoritative price at save/confirm time; this is a preview). A missing
 * price shows an explicit error, never a fabricated $0 — same for
 * availability when the inventory lookup is loading or fails.
 */
function SaleLineRow({
  warehouseId,
  priceListId,
  line,
  onChange,
  onRemove,
}: {
  warehouseId: string | null;
  priceListId: string | null;
  line: SaleLineDraft;
  onChange: (patch: Partial<SaleLineDraft>) => void;
  onRemove: () => void;
}) {
  const isService = line.productType === 'SERVICE';
  const priceQuery = usePriceLookup(
    { priceListId: priceListId ?? '', productVariantId: line.variantId },
    { enabled: !!priceListId },
  );
  const stockQuery = useVariantStock(isService ? null : line.variantId);

  const result = priceQuery.data?.result;
  const balance = stockQuery.data?.warehouses.find((w) => w.warehouseId === warehouseId);

  const quantity = Number(line.quantity || '0');
  const discountPct = Number(line.discountPercentage || '0');
  const gross = result ? quantity * Number(result.price) : null;
  const net = gross !== null ? gross - (gross * discountPct) / 100 : null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {line.label}
            {isService && <span className="ml-2 text-xs text-muted-foreground">Servicio</span>}
          </p>
          {line.sku && <p className="text-xs text-muted-foreground">{line.sku}</p>}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Quitar línea"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Cantidad</span>
          <input
            type="number"
            step="any"
            min="0"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            className={`${inputClassName} w-24`}
            aria-label="Cantidad"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Descuento %</span>
          <input
            type="number"
            step="any"
            min="0"
            max="100"
            value={line.discountPercentage}
            onChange={(e) => onChange({ discountPercentage: e.target.value })}
            className={`${inputClassName} w-24`}
            aria-label="Descuento %"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Precio</span>
          <span className="h-(--control-height) text-sm leading-(--control-height) tabular-nums">
            {!priceListId
              ? '—'
              : priceQuery.isLoading
                ? 'Cargando…'
                : priceQuery.isError || !result
                  ? <span className="text-destructive">Sin precio</span>
                  : formatMoney(result.price, result.currencyCode)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Disponible</span>
          <span className="h-(--control-height) text-sm leading-(--control-height) tabular-nums">
            {isService
              ? 'No aplica'
              : !warehouseId
                ? '—'
                : stockQuery.isLoading
                  ? 'Cargando…'
                  : stockQuery.isError
                    ? <span className="text-destructive">Error</span>
                    : (balance?.available ?? '0')}
          </span>
        </div>
        <div className="ml-auto flex flex-col gap-1 text-right">
          <span className="text-xs text-muted-foreground">Total línea</span>
          <span className="h-(--control-height) text-sm leading-(--control-height) font-medium tabular-nums">
            {net !== null && result ? formatMoney(String(net), result.currencyCode) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function SaleLineEditor({
  warehouseId,
  priceListId,
  lines,
  onChange,
}: {
  warehouseId: string | null;
  priceListId: string | null;
  lines: SaleLineDraft[];
  onChange: (lines: SaleLineDraft[]) => void;
}) {
  function updateLine(key: string, patch: Partial<SaleLineDraft>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    onChange(lines.filter((l) => l.key !== key));
  }
  function addLine(selection: VariantPickerSelection) {
    onChange([
      ...lines,
      {
        key: crypto.randomUUID(),
        variantId: selection.variantId,
        label: selection.label,
        sku: selection.sku,
        productType: selection.productType,
        quantity: '',
        discountPercentage: '0',
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.length > 0 && (
        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <SaleLineRow
              key={line.key}
              warehouseId={warehouseId}
              priceListId={priceListId}
              line={line}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </div>
      )}
      <VariantPicker
        warehouseId={warehouseId}
        excludeVariantIds={lines.map((l) => l.variantId)}
        allowServices
        onSelect={addLine}
      />
    </div>
  );
}
