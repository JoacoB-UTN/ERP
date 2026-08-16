'use client';

import {
  auditActionLabel,
  auditFieldLabel,
  customerAddressTypeLabel,
  formatDecimalDisplay,
  type AuditLogDetail,
} from '@erp/shared';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'creditLimit' || field === 'discountPercentage') {
    return formatDecimalDisplay(String(value)) ?? String(value);
  }
  if (field === 'status') {
    return value === 'ACTIVE' ? 'Activo' : 'Inactivo';
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Customer-specific readable history — simpler than the global Audit
 * screen (see CLAUDE.md/docs/customers.md, section 119): one sentence per
 * event, field-level diffs inline, no raw JSON. Reuses the shared
 * action/field label maps from audit.ts rather than a parallel system.
 */
export function CustomerHistoryItem({ item }: { item: AuditLogDetail }) {
  const actor = item.user?.name ?? 'Sistema';
  const metadata = isPlainObject(item.metadata) ? item.metadata : null;
  const change = typeof metadata?.change === 'string' ? metadata.change : null;

  let title: string;
  let detail: React.ReactNode = null;

  if (item.action === 'CREATE') {
    title = `${actor} creó el cliente.`;
  } else if (item.action === 'DEACTIVATE') {
    title = `${actor} desactivó el cliente.`;
  } else if (item.action === 'ACTIVATE') {
    title = `${actor} reactivó el cliente.`;
  } else if (change === 'address_added') {
    title = `${actor} agregó un domicilio (${customerAddressTypeLabel(String(metadata?.type))}).`;
    detail = <p className="text-sm text-muted-foreground">{String(metadata?.street)}, {String(metadata?.city)}</p>;
  } else if (change === 'address_updated') {
    title = `${actor} modificó un domicilio (${customerAddressTypeLabel(String(metadata?.type))}).`;
  } else if (change === 'address_removed') {
    title = `${actor} quitó un domicilio (${customerAddressTypeLabel(String(metadata?.type))}).`;
  } else if (change === 'contact_added') {
    title = `${actor} agregó un contacto: ${String(metadata?.name)}.`;
  } else if (change === 'contact_updated') {
    title = `${actor} modificó un contacto: ${String(metadata?.name)}.`;
  } else if (change === 'contact_removed') {
    title = `${actor} quitó un contacto: ${String(metadata?.name)}.`;
  } else if (change === 'categories_changed') {
    title = `${actor} modificó las categorías.`;
    const added = Array.isArray(metadata?.categoriesAdded) ? (metadata.categoriesAdded as string[]) : [];
    const removed = Array.isArray(metadata?.categoriesRemoved) ? (metadata.categoriesRemoved as string[]) : [];
    detail = (
      <p className="text-sm text-muted-foreground">
        {added.length > 0 && <span className="text-emerald-600">+ {added.join(', ')} </span>}
        {removed.length > 0 && <span className="text-destructive">− {removed.join(', ')}</span>}
      </p>
    );
  } else if (isPlainObject(item.beforeData) && isPlainObject(item.afterData)) {
    title = `${actor} modificó el cliente.`;
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
    title = `${actor} ${auditActionLabel(item.action).toLowerCase()} el cliente.`;
  }

  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0">
      <p className="text-xs text-muted-foreground">{formatDateTime(item.occurredAt)}</p>
      <p className="text-sm font-medium">{title}</p>
      {detail}
    </div>
  );
}
