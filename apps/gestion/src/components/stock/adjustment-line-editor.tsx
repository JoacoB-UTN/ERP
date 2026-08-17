'use client';

import { X } from 'lucide-react';
import { VariantPicker, type VariantPickerSelection } from './variant-picker';

export interface AdjustmentLineDraft {
  key: string;
  variantId: string;
  label: string;
  sku: string | null;
  direction: 'IN' | 'OUT';
  quantity: string;
  reason: string;
}

/** productVariantId + signed quantityDelta for the API — see docs/inventory.md. */
export function toAdjustmentLineInputs(
  lines: AdjustmentLineDraft[],
): { productVariantId: string; quantityDelta: string; reason?: string }[] {
  return lines.map((l) => ({
    productVariantId: l.variantId,
    quantityDelta: l.direction === 'IN' ? l.quantity : `-${l.quantity}`,
    reason: l.reason.trim() || undefined,
  }));
}

const inputClassName =
  'h-(--control-height) min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

/**
 * Entrada/Salida toggle UX that's internally converted to a signed
 * quantityDelta before it ever reaches the API — the sign convention is a
 * backend/ledger detail, not something a warehouse operator should have to
 * think about (see docs/inventory.md).
 */
export function AdjustmentLineEditor({
  warehouseId,
  lines,
  onChange,
}: {
  warehouseId: string | null;
  lines: AdjustmentLineDraft[];
  onChange: (lines: AdjustmentLineDraft[]) => void;
}) {
  function updateLine(key: string, patch: Partial<AdjustmentLineDraft>) {
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
        direction: 'IN',
        quantity: '',
        reason: '',
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.length > 0 && (
        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <div
              key={line.key}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium">{line.label}</p>
                {line.sku && <p className="text-xs text-muted-foreground">{line.sku}</p>}
              </div>
              <div className="flex h-(--control-height) overflow-hidden rounded-md border border-input bg-card text-sm">
                <button
                  type="button"
                  onClick={() => updateLine(line.key, { direction: 'IN' })}
                  className={`px-2.5 py-1 ${
                    line.direction === 'IN' ? 'bg-emerald-600 text-white' : 'bg-transparent hover:bg-muted'
                  }`}
                >
                  Entrada
                </button>
                <button
                  type="button"
                  onClick={() => updateLine(line.key, { direction: 'OUT' })}
                  className={`px-2.5 py-1 ${
                    line.direction === 'OUT' ? 'bg-red-600 text-white' : 'bg-transparent hover:bg-muted'
                  }`}
                >
                  Salida
                </button>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="Cantidad"
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                className={`${inputClassName} w-28`}
                aria-label="Cantidad"
              />
              <input
                type="text"
                placeholder="Motivo de la línea (opcional)"
                value={line.reason}
                onChange={(e) => updateLine(line.key, { reason: e.target.value })}
                className={`${inputClassName} min-w-40 flex-1`}
                aria-label="Motivo de la línea"
              />
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Quitar línea"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <VariantPicker
        warehouseId={warehouseId}
        excludeVariantIds={lines.map((l) => l.variantId)}
        onSelect={addLine}
      />
    </div>
  );
}
