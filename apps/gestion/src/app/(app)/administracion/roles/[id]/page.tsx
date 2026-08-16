'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError } from '@erp/auth-client';
import type { PermissionDefinition, RoleSummary } from '@erp/shared';
import {
  usePermissions,
  useRole,
  usePermissionCatalog,
  useUpdateRole,
  useDeleteRole,
  useReplaceRolePermissions,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Unauthorized } from '@/components/layout/unauthorized';
import { PermissionEditor } from '@/components/administracion/permission-editor';

export default function RoleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const roleQuery = useRole(id ?? null);
  const catalogQuery = usePermissionCatalog();

  if (permissionsLoading || roleQuery.isLoading || catalogQuery.isLoading) {
    return null;
  }
  if (!can('administration.roles.read') || !roleQuery.data) {
    return <Unauthorized />;
  }

  return (
    <RoleEditorForm
      // Remounts (and re-initializes local form state) whenever the user
      // navigates to a different role — see CLAUDE.md/React guidance:
      // deriving editable state from async data belongs in initial state
      // on a freshly-keyed mount, not in a useEffect that copies props
      // into state after the fact.
      key={roleQuery.data.role.id}
      role={roleQuery.data.role}
      catalog={catalogQuery.data?.permissions ?? []}
      canUpdate={can('administration.roles.update')}
      canDelete={can('administration.roles.delete')}
    />
  );
}

function RoleEditorForm({
  role,
  catalog,
  canUpdate,
  canDelete,
}: {
  role: RoleSummary;
  catalog: PermissionDefinition[];
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();
  const replacePermissions = useReplaceRolePermissions();

  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissionCodes));
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    setSavedMessage(null);
    try {
      if (!role.isSystem) {
        await updateRole.mutateAsync({ roleId: role.id, input: { name, description } });
      } else if (description !== (role.description ?? '')) {
        await updateRole.mutateAsync({ roleId: role.id, input: { description } });
      }
      await replacePermissions.mutateAsync({ roleId: role.id, permissionCodes: [...selected] });
      setSavedMessage('Cambios guardados.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar los cambios.');
    }
  }

  async function handleDelete() {
    if (!window.confirm(`¿Deshabilitar el rol "${role.name}"?`)) {
      return;
    }
    setError(null);
    try {
      await deleteRole.mutateAsync(role.id);
      router.push('/administracion/roles');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar el rol.');
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {role.name}
            {role.isSystem && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Sistema</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">¿Qué puede hacer este rol?</p>
        </div>
        {canDelete && !role.isSystem && (
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteRole.isPending}>
            Eliminar
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canUpdate || role.isSystem}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Descripción</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canUpdate}
          />
        </div>
      </div>

      <PermissionEditor catalog={catalog} selected={selected} onToggle={toggle} disabled={!canUpdate} />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {savedMessage && <p className="text-sm text-emerald-600">{savedMessage}</p>}

      {canUpdate && (
        <div>
          <Button
            type="button"
            onClick={handleSave}
            disabled={updateRole.isPending || replacePermissions.isPending}
          >
            Guardar cambios
          </Button>
        </div>
      )}
    </div>
  );
}
