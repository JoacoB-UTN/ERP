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
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination, TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';

const PAGE_SIZE = 25;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    dateStyle: 'medium',
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
  const hasActiveFilters = !!(dateFrom || dateTo || action || entityType || userId);

  function clearFilters() {
    setDateFrom('');
    setDateTo('');
    setAction('');
    setEntityType('');
    setUserId('');
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Auditoría"
        description="Historial trazable de cambios administrativos, operativos y de seguridad."
      />

      <Toolbar className="flex-col items-stretch">
        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
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
            <Select
              id="action"
              value={action}
              onChange={(e) => onAction(e.target.value)}
            >
              <option value="">Todas</option>
              {Object.values(AuditAction).map((value) => (
                <option key={value} value={value}>
                  {auditActionLabel(value)}
                </option>
              ))}
            </Select>
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
              <Select
                id="userId"
                value={userId}
                onChange={(e) => onUserId(e.target.value)}
              >
                <option value="">Todos</option>
                {(usersQuery.data?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="entityType">Tipo de entidad</Label>
              <Select
                id="entityType"
                value={entityType}
                onChange={(e) => onEntityType(e.target.value)}
              >
                <option value="">Todas</option>
                {AUDITABLE_ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {auditEntityLabel(type)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
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
            {auditQuery.isLoading && <TableRowsSkeleton columns={5} />}
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
            {auditQuery.isError && (
              <TableMessage
                columns={5}
                kind="error"
                title="No pudimos cargar la auditoría"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => auditQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!auditQuery.isLoading && !auditQuery.isError && items.length === 0 && (
              <TableMessage
                columns={5}
                kind={hasActiveFilters ? 'filtered' : 'empty'}
                title={hasActiveFilters ? 'No encontramos eventos' : 'Todavía no hay eventos de auditoría'}
                description={hasActiveFilters ? 'Probá con otro período o limpiá los filtros.' : 'Los cambios auditables aparecerán acá.'}
                action={hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                )}
              />
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <Pagination
          page={pagination.page}
          totalPages={totalPages}
          total={pagination.total}
          itemLabel={pagination.total === 1 ? 'evento' : 'eventos'}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
