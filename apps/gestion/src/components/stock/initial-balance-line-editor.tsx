'use client';

import { X } from 'lucide-react';
import { VariantPicker, type VariantPickerSelection } from './variant-picker';

export interface InitialBalanceLineDraft {
  key: string;
  variantId: string;
  label: string;
  sku: string | null;
  quantity: string;
}

const inputClassName =
  'h-8 min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * No entrada/salida toggle here, unlike AdjustmentLineEditor — an initial
 * balance is always a positive starting quantity (see docs/inventory.md;
 * the backend rejects quantity <= 0 for this operation regardless).
 */
export function InitialBalanceLineEditor({
  warehouseId,
  lines,
  onChange,
}: {
  warehouseId: string | null;
  lines: InitialBalanceLineDraft[];
  onChange: (lines: InitialBalanceLineDraft[]) => void;
}) {
  function updateLine(key: string, patch: Partial<InitialBalanceLineDraft>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    onChange(lines.filter((l) => l.key !== key));
  }
  function addLine(selection: VariantPickerSelection) {
    onChange([
      ...lines,
      { key: crypto.randomUUID(), variantId: selection.variantId, label: selection.label, sku: selection.sku, quantity: '' },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.length > 0 && (
        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <div
              key={line.key}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5"
            >
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium">{line.label}</p>
                {line.sku && <p className="text-xs text-muted-foreground">{line.sku}</p>}
              </div>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="Cantidad inicial"
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                className={`${inputClassName} w-32`}
                aria-label="Cantidad inicial"
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
