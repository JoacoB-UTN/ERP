'use client';

import {
  auditActionLabel,
  auditFieldLabel,
  productTypeLabel,
  productCodeTypeLabel,
  formatDecimalDisplay,
  type AuditLogDetail,
} from '@erp/shared';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

const BOOLEAN_FIELDS = new Set([
  'trackInventory',
  'trackLots',
  'trackSerials',
  'allowNegativeStock',
]);

function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'minimumStock' || field === 'maximumStock' || field === 'reorderPoint') {
    return formatDecimalDisplay(String(value)) ?? String(value);
  }
  if (field === 'status') {
    return value === 'ACTIVE' ? 'Activo' : 'Inactivo';
  }
  if (field === 'productType') {
    return productTypeLabel(String(value));
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return value === true ? 'Sí' : 'No';
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Product-specific readable history — one sentence per event, field-level
 * diffs inline, no raw JSON. Mirrors CustomerHistoryItem's pattern (see
 * docs/customers.md, docs/products.md).
 */
export function ProductHistoryItem({ item }: { item: AuditLogDetail }) {
  const actor = item.user?.name ?? 'Sistema';
  const metadata = isPlainObject(item.metadata) ? item.metadata : null;
  const change = typeof metadata?.change === 'string' ? metadata.change : null;

  let title: string;
  let detail: React.ReactNode = null;

  if (item.action === 'CREATE') {
    title = `${actor} creó el producto.`;
  } else if (item.action === 'DEACTIVATE' && !change) {
    title = `${actor} desactivó el producto.`;
  } else if (item.action === 'ACTIVATE' && !change) {
    title = `${actor} reactivó el producto.`;
  } else if (change === 'variant_added') {
    title = `${actor} agregó una variante${metadata?.name ? `: ${String(metadata.name)}` : ''}.`;
    if (metadata?.sku) detail = <p className="text-sm text-muted-foreground">SKU: {String(metadata.sku)}</p>;
  } else if (change === 'variant_updated') {
    title = `${actor} modificó una variante${metadata?.name ? `: ${String(metadata.name)}` : ''}.`;
  } else if (change === 'variant_deactivated') {
    title = `${actor} desactivó una variante${metadata?.name ? `: ${String(metadata.name)}` : ''}.`;
  } else if (change === 'variant_reactivated') {
    title = `${actor} reactivó una variante${metadata?.name ? `: ${String(metadata.name)}` : ''}.`;
  } else if (change === 'code_added') {
    title = `${actor} agregó un código (${productCodeTypeLabel(String(metadata?.type))}): ${String(metadata?.code)}.`;
  } else if (change === 'code_updated') {
    title = `${actor} modificó un código (${productCodeTypeLabel(String(metadata?.type))}): ${String(metadata?.previousCode)} → ${String(metadata?.code)}.`;
  } else if (change === 'code_removed') {
    title = `${actor} quitó un código (${productCodeTypeLabel(String(metadata?.type))}): ${String(metadata?.code)}.`;
  } else if (change === 'category_changed') {
    title = 'Categoría';
    detail = (
      <p className="text-sm text-muted-foreground">
        {actor}: {String(metadata?.previousCategoryName ?? 'Sin categoría')} → {String(metadata?.newCategoryName ?? 'Sin categoría')}
      </p>
    );
  } else if (change === 'brand_changed') {
    title = 'Marca';
    detail = (
      <p className="text-sm text-muted-foreground">
        {actor}: {String(metadata?.previousBrandName ?? 'Sin marca')} → {String(metadata?.newBrandName ?? 'Sin marca')}
      </p>
    );
  } else if (isPlainObject(item.beforeData) && isPlainObject(item.afterData)) {
    title = `${actor} modificó el producto.`;
    const before = item.beforeData;
    const after = item.afterData;
    const fields = Object.keys(after);
    detail = (
      <ul className="flex flex-col gap-0.5">
        {fields.map((field) => (
          <li key={field} className="text-sm text-muted-foreground">
            {auditFieldLabel(field)}: {formatFieldValue(field, before[field])} → {formatFieldValue(field, after[field])}
          </li>
        ))}
      </ul>
    );
  } else {
    title = `${actor} ${auditActionLabel(item.action).toLowerCase()} el producto.`;
  }

  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0">
      <p className="text-xs text-muted-foreground">{formatDateTime(item.occurredAt)}</p>
      <p className="text-sm font-medium">{title}</p>
      {detail}
    </div>
  );
}
