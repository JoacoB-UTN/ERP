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
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
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
    </div>
  );
}

export default function UsersPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const usersQuery = useCompanyUsers();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  if (permissionsLoading || usersQuery.isLoading) {
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Usuarios con acceso a esta empresa. Elegí uno para ver o cambiar sus roles.
        </p>
      </div>

      <Input
        placeholder="Buscar usuario…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
        aria-label="Buscar usuario"
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Roles</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => setSelectedUserId(user.id)}
                  className={cn(
                    'cursor-pointer border-t border-border hover:bg-muted/40',
                    selectedUserId === user.id && 'bg-muted/60',
                  )}
                >
                  <td className="px-4 py-2 font-medium">
                    {user.firstName} {user.lastName}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-2">{user.status === 'ACTIVE' ? 'Activo' : user.status}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {user.roles.length > 0 ? user.roles.map((r) => r.name).join(', ') : '—'}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No se encontraron usuarios.
                  </td>
                </tr>
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
