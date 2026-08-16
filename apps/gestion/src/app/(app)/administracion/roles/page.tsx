'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { usePermissions, useRoles } from '@/lib/auth-client';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Unauthorized } from '@/components/layout/unauthorized';

export default function RolesPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const rolesQuery = useRoles();
  const [search, setSearch] = useState('');

  if (permissionsLoading || rolesQuery.isLoading) {
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles y permisos</h1>
          <p className="text-sm text-muted-foreground">
            Definí qué puede hacer cada rol y asignalo a los usuarios de la empresa.
          </p>
        </div>
        {canCreate && (
          <Link href="/administracion/roles/nuevo" className={buttonVariants()}>
            <Plus className="size-4" />
            Nuevo rol
          </Link>
        )}
      </div>

      <Input
        placeholder="Buscar rol…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
        aria-label="Buscar rol"
      />

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Descripción</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link
                    href={`/administracion/roles/${role.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {role.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{role.description ?? '—'}</td>
                <td className="px-4 py-2">
                  {role.isSystem && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Sistema</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {role.active ? (
                    <span className="text-emerald-600">Activo</span>
                  ) : (
                    <span className="text-muted-foreground">Inactivo</span>
                  )}
                </td>
              </tr>
            ))}
            {roles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  No se encontraron roles.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
