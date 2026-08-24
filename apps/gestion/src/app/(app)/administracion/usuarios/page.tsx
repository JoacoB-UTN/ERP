'use client';

import { useState } from 'react';
import { ApiError } from '@erp/auth-client';
import {
  usePermissions,
  useCompanyUsers,
  useRoles,
  useUserRoles,
  useAssignRole,
  useRemoveRoleAssignment,
} from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';
import { cn } from '@/lib/utils';

function RoleAssignmentPanel({ userId, userName }: { userId: string; userName: string }) {
  const { can } = usePermissions();
  const rolesQuery = useRoles();
  const userRolesQuery = useUserRoles(userId);
  const assignRole = useAssignRole();
  const removeRole = useRemoveRoleAssignment();
  const [error, setError] = useState<string | null>(null);

  const canAssign = can('administration.roles.assign');
  const assignedIds = new Set((userRolesQuery.data?.roles ?? []).map((r) => r.id));

  async function toggle(roleId: string, assigned: boolean) {
    setError(null);
    try {
      if (assigned) {
        await removeRole.mutateAsync({ userId, roleId });
      } else {
        await assignRole.mutateAsync({ userId, roleId });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el rol.');
    }
  }

  if (rolesQuery.isLoading || userRolesQuery.isLoading) {
    return <div className="h-32 animate-pulse rounded-md border border-border bg-muted/60" aria-label="Cargando roles" />;
  }

  return (
    <aside className="flex flex-col gap-3 rounded-md border border-border bg-card p-3" aria-label={`Roles de ${userName}`}>
      <p className="text-sm font-medium">
        Roles de <span className="font-semibold">{userName}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        {(rolesQuery.data?.roles ?? [])
          .filter((role) => role.active)
          .map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assignedIds.has(role.id)}
                onChange={() => toggle(role.id, assignedIds.has(role.id))}
                disabled={!canAssign || assignRole.isPending || removeRole.isPending}
                className="size-4 rounded border-border"
              />
              {role.name}
            </label>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </aside>
  );
}

export default function UsersPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const usersQuery = useCompanyUsers();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  if (permissionsLoading) {
    return null;
  }
  if (!can('administration.users.read')) {
    return <Unauthorized />;
  }

  const users = (usersQuery.data?.users ?? []).filter((user) =>
    `${user.firstName} ${user.lastName} ${user.email}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader title="Usuarios" meta={`${users.length} ${users.length === 1 ? 'usuario' : 'usuarios'}`} />

      <Toolbar>
        <Input
          placeholder="Buscar usuario…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs py-1 text-sm"
          aria-label="Buscar usuario"
        />
      </Toolbar>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5">Nombre</th>
                <th className="px-3 py-1.5">Email</th>
                <th className="px-3 py-1.5">Estado</th>
                <th className="px-3 py-1.5">Roles</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.isLoading && <TableRowsSkeleton columns={4} />}
              {users.map((user) => (
                <tr
                  key={user.id}
                  className={cn(
                    'border-t border-border hover:bg-muted/30',
                    selectedUserId === user.id && 'bg-muted/60',
                  )}
                >
                  <td className="px-3 py-1 font-medium">
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      aria-pressed={selectedUserId === user.id}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      {user.firstName} {user.lastName}
                    </button>
                  </td>
                  <td className="px-3 py-1 text-muted-foreground">{user.email}</td>
                  <td className="px-3 py-1">
                    <StatusBadge status={user.status}>{user.status === 'ACTIVE' ? 'Activo' : user.status}</StatusBadge>
                  </td>
                  <td className="px-3 py-1 text-muted-foreground">
                    {user.roles.length > 0 ? user.roles.map((r) => r.name).join(', ') : '—'}
                  </td>
                </tr>
              ))}
              {usersQuery.isError && (
                <TableMessage
                  columns={4}
                  kind="error"
                  title="No pudimos cargar los usuarios"
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={() => usersQuery.refetch()}>
                      Reintentar
                    </Button>
                  }
                />
              )}
              {!usersQuery.isLoading && !usersQuery.isError && users.length === 0 && (
                <TableMessage
                  columns={4}
                  kind={search ? 'filtered' : 'empty'}
                  title={search ? 'No encontramos usuarios' : 'No hay usuarios para mostrar'}
                  description={search ? 'Probá con otro nombre o email.' : undefined}
                />
              )}
            </tbody>
          </table>
        </div>

        {selectedUser && (
          <RoleAssignmentPanel
            userId={selectedUser.id}
            userName={`${selectedUser.firstName} ${selectedUser.lastName}`}
          />
        )}
      </div>
    </div>
  );
}
