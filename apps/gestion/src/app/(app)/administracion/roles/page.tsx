'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { usePermissions, useRoles } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';

export default function RolesPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const rolesQuery = useRoles();
  const [search, setSearch] = useState('');

  if (permissionsLoading) {
    return null;
  }
  if (!can('administration.roles.read')) {
    return <Unauthorized />;
  }

  const roles = (rolesQuery.data?.roles ?? []).filter((role) =>
    role.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const canCreate = can('administration.roles.create');

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Roles y permisos"
        meta={`${roles.length} ${roles.length === 1 ? 'rol' : 'roles'}`}
        actions={canCreate && (
          <Link href="/administracion/roles/nuevo" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Nuevo rol
          </Link>
        )}
      />

      <Toolbar>
        <Input
          placeholder="Buscar rol…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs py-1 text-sm"
          aria-label="Buscar rol"
        />
      </Toolbar>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Nombre</th>
              <th className="px-3 py-1.5">Descripción</th>
              <th className="px-3 py-1.5">Tipo</th>
              <th className="px-3 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rolesQuery.isLoading && <TableRowsSkeleton columns={4} />}
            {roles.map((role) => (
              <tr key={role.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1">
                  <Link
                    href={`/administracion/roles/${role.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {role.name}
                  </Link>
                </td>
                <td className="px-3 py-1 text-muted-foreground">{role.description ?? '—'}</td>
                <td className="px-3 py-1">
                  {role.isSystem && (
                    <StatusBadge tone="info">Sistema</StatusBadge>
                  )}
                </td>
                <td className="px-3 py-1">
                  <StatusBadge status={role.active ? 'ACTIVE' : 'INACTIVE'}>
                    {role.active ? 'Activo' : 'Inactivo'}
                  </StatusBadge>
                </td>
              </tr>
            ))}
            {rolesQuery.isError && (
              <TableMessage
                columns={4}
                kind="error"
                title="No pudimos cargar los roles"
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => rolesQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!rolesQuery.isLoading && !rolesQuery.isError && roles.length === 0 && (
              <TableMessage
                columns={4}
                kind={search ? 'filtered' : 'empty'}
                title={search ? 'No encontramos roles' : 'No hay roles para mostrar'}
                description={search ? 'Probá con otro nombre.' : undefined}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
