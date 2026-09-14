'use client';

import { X } from 'lucide-react';
import { VariantPicker, type VariantPickerSelection } from './variant-picker';

export interface TransferLineDraft {
  key: string;
  variantId: string;
  label: string;
  sku: string | null;
  quantity: string;
  notes: string;
}

/**
 * Quantities go to the API strictly positive — see docs/inventory.md.
 * Unlike an adjustment, a transfer has no Entrada/Salida toggle: the header
 * already says which warehouse the stock leaves and which one it reaches, so
 * a per-line direction would be a second, contradictable way to say the same
 * thing.
 */
export function toTransferLineInputs(
  lines: TransferLineDraft[],
): { productVariantId: string; quantity: string; notes?: string }[] {
  return lines.map((l) => ({
    productVariantId: l.variantId,
    quantity: l.quantity,
    notes: l.notes.trim() || undefined,
  }));
}

const inputClassName =
  'h-(--control-height) min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

export function TransferLineEditor({
  sourceWarehouseId,
  lines,
  onChange,
}: {
  /** Drives the picker's availability figures: stock leaves THIS warehouse. */
  sourceWarehouseId: string | null;
  lines: TransferLineDraft[];
  onChange: (lines: TransferLineDraft[]) => void;
}) {
  function updateLine(key: string, patch: Partial<TransferLineDraft>) {
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
        notes: '',
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
              <input
                type="number"
                step="any"
                min="0"
                placeholder="Cantidad"
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                className={`${inputClassName} w-28`}
                aria-label="Cantidad a transferir"
              />
              <input
                type="text"
                placeholder="Nota de la línea (opcional)"
                value={line.notes}
                onChange={(e) => updateLine(line.key, { notes: e.target.value })}
                className={`${inputClassName} min-w-40 flex-1`}
                aria-label="Nota de la línea"
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
        warehouseId={sourceWarehouseId}
        excludeVariantIds={lines.map((l) => l.variantId)}
        onSelect={addLine}
      />
    </div>
  );
}
