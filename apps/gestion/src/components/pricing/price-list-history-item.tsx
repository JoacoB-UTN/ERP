'use client';

import { auditActionLabel, auditFieldLabel, adjustmentTypeLabel, type AuditLogDetail } from '@erp/shared';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

const BOOLEAN_FIELDS = new Set(['includesTax', 'isDefault']);

function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (BOOLEAN_FIELDS.has(field)) {
    return value === true ? 'Sí' : 'No';
  }
  if (field === 'adjustmentType') {
    return adjustmentTypeLabel(String(value));
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * PriceList administrative history — one sentence per event, field-level
 * diffs inline. Mirrors ProductHistoryItem's pattern (see docs/pricing.md:
 * this is the "who performed the administrative action" trail, distinct
 * from PriceHistory's "how did the commercial price evolve").
 */
export function PriceListHistoryItem({ item }: { item: AuditLogDetail }) {
  const actor = item.user?.name ?? 'Sistema';
  const metadata = isPlainObject(item.metadata) ? item.metadata : null;
  const change = typeof metadata?.change === 'string' ? metadata.change : null;

  let title: string;
  let detail: React.ReactNode = null;

  if (item.action === 'CREATE') {
    title = `${actor} creó la lista de precios.`;
  } else if (item.action === 'DEACTIVATE') {
    title = `${actor} desactivó la lista de precios.`;
  } else if (item.action === 'ACTIVATE') {
    title = `${actor} reactivó la lista de precios.`;
  } else if (change === 'price_set') {
    title = `${actor} actualizó un precio.`;
    detail = (
      <ul className="flex flex-col gap-0.5">
        {Boolean(metadata?.newPrice) && (
          <li className="text-sm text-muted-foreground">Nuevo precio: {String(metadata?.newPrice)}</li>
        )}
        {Boolean(metadata?.effectiveFrom) && (
          <li className="text-sm text-muted-foreground">Vigente desde: {String(metadata?.effectiveFrom)}</li>
        )}
        {Boolean(metadata?.reason) && (
          <li className="text-sm text-muted-foreground">Motivo: {String(metadata?.reason)}</li>
        )}
      </ul>
    );
  } else if (change === 'prices_batch_set') {
    title = `${actor} actualizó varios precios a la vez.`;
    detail = (
      <ul className="flex flex-col gap-0.5">
        {metadata?.affectedCount !== undefined && (
          <li className="text-sm text-muted-foreground">Productos actualizados: {String(metadata.affectedCount)}</li>
        )}
        {Boolean(metadata?.effectiveFrom) && (
          <li className="text-sm text-muted-foreground">Vigentes desde: {String(metadata?.effectiveFrom)}</li>
        )}
        {Boolean(metadata?.reason) && (
          <li className="text-sm text-muted-foreground">Motivo: {String(metadata?.reason)}</li>
        )}
      </ul>
    );
  } else if (change === 'bulk_adjustment') {
    title = `${actor} aplicó una actualización masiva de precios.`;
    detail = (
      <ul className="flex flex-col gap-0.5">
        {Boolean(metadata?.adjustmentType) && (
          <li className="text-sm text-muted-foreground">
            Ajuste: {adjustmentTypeLabel(String(metadata?.adjustmentType))} {String(metadata?.value ?? '')}
          </li>
        )}
        {Boolean(metadata?.effectiveFrom) && (
          <li className="text-sm text-muted-foreground">Vigencia desde: {String(metadata?.effectiveFrom)}</li>
        )}
        {metadata?.affectedCount !== undefined && (
          <li className="text-sm text-muted-foreground">Productos afectados: {String(metadata.affectedCount)}</li>
        )}
        {Boolean(metadata?.scope) && (
          <li className="text-sm text-muted-foreground">Alcance: {String(metadata?.scope)}</li>
        )}
        {Boolean(metadata?.reason) && (
          <li className="text-sm text-muted-foreground">Motivo: {String(metadata?.reason)}</li>
        )}
      </ul>
    );
  } else if (isPlainObject(item.beforeData) && isPlainObject(item.afterData)) {
    title = `${actor} modificó la lista de precios.`;
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
    title = `${actor} ${auditActionLabel(item.action).toLowerCase()} la lista de precios.`;
  }

  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0">
      <p className="text-xs text-muted-foreground">{formatDateTime(item.occurredAt)}</p>
      <p className="text-sm font-medium">{title}</p>
      {detail}
    </div>
  );
}
