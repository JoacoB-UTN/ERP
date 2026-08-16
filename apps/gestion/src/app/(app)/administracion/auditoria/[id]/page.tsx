'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  auditActionLabel,
  auditEntityLabel,
  auditFieldLabel,
  PERMISSION_CATALOG,
} from '@erp/shared';
import { usePermissions, useAuditLogDetail } from '@/lib/auth-client';
import { Unauthorized } from '@/components/layout/unauthorized';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    dateStyle: 'long',
    timeStyle: 'medium',
  });
}

function permissionLabel(code: string): string {
  return PERMISSION_CATALOG.find((p) => p.code === code)?.description ?? code;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
}

/** Field-by-field diff between two flat before/after objects — no giant JSON dump. */
function FieldDiff({ before, after }: { before: unknown; after: unknown }) {
  if (!isPlainObject(before) || !isPlainObject(after)) {
    return null;
  }
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = fields.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
  if (changed.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin cambios en los campos registrados.</p>;
  }
  return (
    <dl className="flex flex-col gap-3">
      {changed.map((field) => (
        <div key={field} className="flex flex-col gap-0.5">
          <dt className="text-sm font-medium">{auditFieldLabel(field)}</dt>
          <dd className="text-sm text-muted-foreground">
            Antes: <span className="text-foreground">{formatValue(before[field])}</span>
          </dd>
          <dd className="text-sm text-muted-foreground">
            Después: <span className="text-foreground">{formatValue(after[field])}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Purpose-built rendering for PERMISSIONS_CHANGE's {permissionsAdded, permissionsRemoved} metadata — see docs/audit-architecture.md. */
function PermissionsChangeDiff({ metadata }: { metadata: unknown }) {
  if (!isPlainObject(metadata)) return null;
  const added = Array.isArray(metadata.permissionsAdded) ? (metadata.permissionsAdded as string[]) : [];
  const removed = Array.isArray(metadata.permissionsRemoved) ? (metadata.permissionsRemoved as string[]) : [];
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {added.length > 0 && (
        <div>
          <p className="text-sm font-medium">Permisos agregados</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {added.map((code) => (
              <li key={code} className="text-sm text-emerald-600">
                + {permissionLabel(code)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {removed.length > 0 && (
        <div>
          <p className="text-sm font-medium">Permisos quitados</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {removed.map((code) => (
              <li key={code} className="text-sm text-destructive">
                − {permissionLabel(code)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AuditoriaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const detailQuery = useAuditLogDetail(id ?? null);

  if (permissionsLoading || detailQuery.isLoading) {
    return null;
  }
  if (!can('administration.audit.read') || !detailQuery.data) {
    return <Unauthorized />;
  }

  const { auditLog } = detailQuery.data;
  const isPermissionsChange = auditLog.action === 'PERMISSIONS_CHANGE';
  const hasFieldDiff = isPlainObject(auditLog.beforeData) || isPlainObject(auditLog.afterData);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/administracion/auditoria"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver a Auditoría
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {auditActionLabel(auditLog.action)} {auditEntityLabel(auditLog.entityType).toLowerCase()}
        </h1>
        <p className="text-sm text-muted-foreground">{formatDateTime(auditLog.occurredAt)}</p>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Quién</dt>
          <dd className="font-medium">{auditLog.user?.name ?? 'Sistema'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Acción</dt>
          <dd className="font-medium">{auditActionLabel(auditLog.action)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Entidad</dt>
          <dd className="font-medium">{auditEntityLabel(auditLog.entityType)}</dd>
        </div>
      </dl>

      {isPermissionsChange && (
        <div className="rounded-xl border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Cambios de permisos</h2>
          <PermissionsChangeDiff metadata={auditLog.metadata} />
        </div>
      )}

      {!isPermissionsChange && hasFieldDiff && (
        <div className="rounded-xl border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Cambios</h2>
          <FieldDiff before={auditLog.beforeData} after={auditLog.afterData} />
        </div>
      )}

      <details className="rounded-xl border border-border p-4 text-sm">
        <summary className="cursor-pointer font-medium text-muted-foreground">
          Detalle técnico (avanzado)
        </summary>
        <pre className="mt-3 overflow-x-auto text-xs text-muted-foreground">
          {JSON.stringify(
            {
              beforeData: auditLog.beforeData,
              afterData: auditLog.afterData,
              metadata: auditLog.metadata,
              requestId: auditLog.requestId,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
