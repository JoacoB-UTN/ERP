'use client';

import { X } from 'lucide-react';
import { VariantPicker, type VariantPickerSelection } from '@/components/stock/variant-picker';

export interface PurchaseOrderLineDraft {
  key: string;
  variantId: string;
  label: string;
  sku: string | null;
  quantity: string;
  unitCost: string;
}

export function toPurchaseOrderLineInputs(
  lines: PurchaseOrderLineDraft[],
): { productVariantId: string; quantity: string; unitCost: string }[] {
  return lines.map((l) => ({
    productVariantId: l.variantId,
    quantity: l.quantity,
    unitCost: l.unitCost,
  }));
}

const inputClassName =
  'h-(--control-height) min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

/**
 * One Purchase Order line — quantity and unitCost are BOTH entered by
 * hand, unlike a Sales line's price (see docs/purchases.md: there is no
 * pricing engine for supplier costs to resolve from). Line total is a
 * client-side preview only; the server always recomputes it
 * authoritatively.
 */
function PurchaseOrderLineRow({
  line,
  currencyCode,
  onChange,
  onRemove,
}: {
  line: PurchaseOrderLineDraft;
  currencyCode: string;
  onChange: (patch: Partial<PurchaseOrderLineDraft>) => void;
  onRemove: () => void;
}) {
  const quantity = Number(line.quantity || '0');
  const unitCost = Number(line.unitCost || '0');
  const lineTotal = quantity * unitCost;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{line.label}</p>
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
          <span className="text-xs text-muted-foreground">Costo unitario ({currencyCode})</span>
          <input
            type="number"
            step="any"
            min="0"
            value={line.unitCost}
            onChange={(e) => onChange({ unitCost: e.target.value })}
            className={`${inputClassName} w-32`}
            aria-label="Costo unitario"
          />
        </div>
        <div className="ml-auto flex flex-col gap-1 text-right">
          <span className="text-xs text-muted-foreground">Total línea</span>
          <span className="h-(--control-height) text-sm leading-(--control-height) font-medium tabular-nums">
            {currencyCode} {lineTotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}

export function PurchaseOrderLineEditor({
  currencyCode,
  lines,
  onChange,
}: {
  currencyCode: string;
  lines: PurchaseOrderLineDraft[];
  onChange: (lines: PurchaseOrderLineDraft[]) => void;
}) {
  function updateLine(key: string, patch: Partial<PurchaseOrderLineDraft>) {
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
        quantity: '',
        unitCost: '',
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.length > 0 && (
        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <PurchaseOrderLineRow
              key={line.key}
              line={line}
              currencyCode={currencyCode}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </div>
      )}
      <VariantPicker
        warehouseId={null}
        excludeVariantIds={lines.map((l) => l.variantId)}
        onSelect={addLine}
      />
    </div>
  );
}
