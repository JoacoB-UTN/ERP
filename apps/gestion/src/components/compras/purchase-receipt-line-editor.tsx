'use client';

import { X } from 'lucide-react';
import type { PurchaseOrderLineDto } from '@erp/shared';
import { formatDecimalDisplay } from '@erp/shared';
import { VariantPicker, type VariantPickerSelection } from '@/components/stock/variant-picker';

export interface PurchaseReceiptLineDraft {
  key: string;
  variantId: string;
  label: string;
  sku: string | null;
  quantity: string;
  unitCostSnapshot: string;
  purchaseOrderLineId?: string;
}

export function toPurchaseReceiptLineInputs(lines: PurchaseReceiptLineDraft[]): {
  productVariantId: string;
  quantity: string;
  unitCostSnapshot: string;
  purchaseOrderLineId?: string;
}[] {
  return lines.map((l) => ({
    productVariantId: l.variantId,
    quantity: l.quantity,
    unitCostSnapshot: l.unitCostSnapshot,
    purchaseOrderLineId: l.purchaseOrderLineId,
  }));
}

const inputClassName =
  'h-(--control-height) min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

function ReceiptLineRow({
  line,
  currencyCode,
  maxQuantity,
  onChange,
  onRemove,
}: {
  line: PurchaseReceiptLineDraft;
  currencyCode: string;
  /** Client-side hint only (a PO-linked line's pending quantity) — the server is the concurrency-safe authority, see docs/purchases.md. */
  maxQuantity?: string;
  onChange: (patch: Partial<PurchaseReceiptLineDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{line.label}</p>
          {line.sku && <p className="text-xs text-muted-foreground">{line.sku}</p>}
          {maxQuantity !== undefined && (
            <p className="text-xs text-muted-foreground">Pendiente: {formatDecimalDisplay(maxQuantity, 6)}</p>
          )}
        </div>
        {!line.purchaseOrderLineId && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Quitar línea"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Cantidad a recibir</span>
          <input
            type="number"
            step="any"
            min="0"
            max={maxQuantity}
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            className={`${inputClassName} w-28`}
            aria-label="Cantidad a recibir"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Costo unitario ({currencyCode})</span>
          <input
            type="number"
            step="any"
            min="0"
            value={line.unitCostSnapshot}
            onChange={(e) => onChange({ unitCostSnapshot: e.target.value })}
            className={`${inputClassName} w-32`}
            aria-label="Costo unitario"
          />
        </div>
      </div>
    </div>
  );
}

/** Direct receipt (no purchaseOrderId) — free product selection via VariantPicker, same shape as PurchaseOrderLineEditor. */
export function DirectReceiptLineEditor({
  currencyCode,
  lines,
  onChange,
}: {
  currencyCode: string;
  lines: PurchaseReceiptLineDraft[];
  onChange: (lines: PurchaseReceiptLineDraft[]) => void;
}) {
  function updateLine(key: string, patch: Partial<PurchaseReceiptLineDraft>) {
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
        unitCostSnapshot: '',
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.length > 0 && (
        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <ReceiptLineRow
              key={line.key}
              line={line}
              currencyCode={currencyCode}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </div>
      )}
      <VariantPicker warehouseId={null} excludeVariantIds={lines.map((l) => l.variantId)} onSelect={addLine} />
    </div>
  );
}

/**
 * PO-linked receipt — one checkbox per pending order line (fully received
 * lines are hidden). Checking a line seeds its quantity at the FULL
 * pending amount and its cost at the order's quoted unitCost, both still
 * editable — the pending amount shown is a client-side hint only; the
 * server's lock-protected check at confirm time is the actual guarantee
 * against over-receipt (see docs/purchases.md's "Concurrency" section).
 */
export function OrderReceiptLineEditor({
  currencyCode,
  orderLines,
  lines,
  onChange,
}: {
  currencyCode: string;
  orderLines: PurchaseOrderLineDto[];
  lines: PurchaseReceiptLineDraft[];
  onChange: (lines: PurchaseReceiptLineDraft[]) => void;
}) {
  const pendingLines = orderLines.filter((l) => Number(l.pendingQuantity) > 0);

  function lineFor(orderLineId: string) {
    return lines.find((l) => l.purchaseOrderLineId === orderLineId);
  }
  function toggleLine(orderLine: PurchaseOrderLineDto, checked: boolean) {
    if (checked) {
      onChange([
        ...lines,
        {
          key: crypto.randomUUID(),
          variantId: orderLine.productVariantId,
          label: orderLine.description,
          sku: orderLine.sku,
          quantity: orderLine.pendingQuantity,
          unitCostSnapshot: orderLine.unitCost,
          purchaseOrderLineId: orderLine.id,
        },
      ]);
    } else {
      onChange(lines.filter((l) => l.purchaseOrderLineId !== orderLine.id));
    }
  }
  function updateLine(key: string, patch: Partial<PurchaseReceiptLineDraft>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  if (pendingLines.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta orden no tiene líneas pendientes de recepción.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {pendingLines.map((orderLine) => {
        const draft = lineFor(orderLine.id);
        return (
          <div key={orderLine.id} className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={!!draft}
                onChange={(e) => toggleLine(orderLine, e.target.checked)}
              />
              {orderLine.description}
              {orderLine.sku && <span className="text-xs font-normal text-muted-foreground">{orderLine.sku}</span>}
            </label>
            <p className="pl-6 text-xs text-muted-foreground">
              Pendiente: {formatDecimalDisplay(orderLine.pendingQuantity, 6)} de{' '}
              {formatDecimalDisplay(orderLine.quantity, 6)}
            </p>
            {draft && (
              <div className="flex flex-wrap items-end gap-3 pl-6">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Cantidad a recibir</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max={orderLine.pendingQuantity}
                    value={draft.quantity}
                    onChange={(e) => updateLine(draft.key, { quantity: e.target.value })}
                    className={`${inputClassName} w-28`}
                    aria-label="Cantidad a recibir"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Costo unitario ({currencyCode})</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={draft.unitCostSnapshot}
                    onChange={(e) => updateLine(draft.key, { unitCostSnapshot: e.target.value })}
                    className={`${inputClassName} w-32`}
                    aria-label="Costo unitario"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
