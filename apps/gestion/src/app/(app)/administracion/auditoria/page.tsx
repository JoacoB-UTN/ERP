'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  AUDITABLE_ENTITY_TYPES,
  AuditAction,
  auditActionLabel,
  auditEntityLabel,
} from '@erp/shared';
import { usePermissions, useAuditLog, useCompanyUsers } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';

const PAGE_SIZE = 25;

const selectClassName =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default function AuditoriaPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const usersQuery = useCompanyUsers();

  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [userId, setUserId] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const filters = useMemo(
    () => ({
      dateFrom: dateFrom || undefined,
      // End-of-day so the selected "hasta" date is inclusive.
      dateTo: dateTo ? `${dateTo}T23:59:59.999` : undefined,
      action: action || undefined,
      entityType: entityType || undefined,
      userId: userId || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [dateFrom, dateTo, action, entityType, userId, page],
  );

  const auditQuery = useAuditLog(filters);

  if (permissionsLoading) {
    return null;
  }
  if (!can('administration.audit.read')) {
    return <Unauthorized />;
  }

  function resetPageAnd<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }
  const onDateFrom = resetPageAnd(setDateFrom);
  const onDateTo = resetPageAnd(setDateTo);
  const onAction = resetPageAnd(setAction);
  const onEntityType = resetPageAnd(setEntityType);
  const onUserId = resetPageAnd(setUserId);

  const items = auditQuery.data?.items ?? [];
  const pagination = auditQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoría</h1>
        <p className="text-sm text-muted-foreground">
          Historial de cambios administrativos y de seguridad de esta empresa.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dateFrom">Desde</Label>
            <Input
              id="dateFrom"
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dateTo">Hasta</Label>
            <Input id="dateTo" type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="action">Acción</Label>
            <select
              id="action"
              className={selectClassName}
              value={action}
              onChange={(e) => onAction(e.target.value)}
            >
              <option value="">Todas</option>
              {Object.values(AuditAction).map((value) => (
                <option key={value} value={value}>
                  {auditActionLabel(value)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setShowMoreFilters((v) => !v)}
        >
          {showMoreFilters ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          Más filtros
        </button>

        {showMoreFilters && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="userId">Usuario</Label>
              <select
                id="userId"
                className={selectClassName}
                value={userId}
                onChange={(e) => onUserId(e.target.value)}
              >
                <option value="">Todos</option>
                {(usersQuery.data?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="entityType">Tipo de entidad</Label>
              <select
                id="entityType"
                className={selectClassName}
                value={entityType}
                onChange={(e) => onEntityType(e.target.value)}
              >
                <option value="">Todas</option>
                {AUDITABLE_ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {auditEntityLabel(type)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Fecha y hora</th>
              <th className="px-4 py-2">Usuario</th>
              <th className="px-4 py-2">Acción</th>
              <th className="px-4 py-2">Entidad</th>
              <th className="px-4 py-2">Detalle breve</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                  {formatDateTime(entry.occurredAt)}
                </td>
                <td className="px-4 py-2">{entry.user?.name ?? 'Sistema'}</td>
                <td className="px-4 py-2">{auditActionLabel(entry.action)}</td>
                <td className="px-4 py-2">{auditEntityLabel(entry.entityType)}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/administracion/auditoria/${entry.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {auditActionLabel(entry.action)} {auditEntityLabel(entry.entityType).toLowerCase()}
                  </Link>
                </td>
              </tr>
            ))}
            {!auditQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No se encontraron eventos de auditoría.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {totalPages} — {pagination.total} evento
            {pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
