'use client';

import { useState, type FormEvent } from 'react';
import { ApiError } from '@erp/auth-client';
import { PASSWORD_MIN_LENGTH, createUserSchema } from '@erp/shared';
import { useCreateUser, usePermissions, useRoles } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY = { firstName: '', lastName: '', email: '', password: '' };

/**
 * Create-user form, in a dialog rather than its own route.
 *
 * Roles live on the same screen, so this is a create-and-onboard step, not a
 * bare account: an administrator adding somebody almost always knows what
 * they are there to do, and a second trip through a side panel to say so is
 * the part that gets skipped. Only ACTIVE roles are offered — assigning an
 * inactive one is rejected by the API anyway (RoleNotFoundException with
 * requireActive), and offering it would only produce a confusing failure.
 *
 * The role checkboxes are hidden without `administration.roles.assign`. That
 * is presentation only, and it matches the server: UsersService.create()
 * refuses a request that carries roles without that permission, so somebody
 * hand-posting the body cannot escalate past the hidden control.
 *
 * Validation runs through `createUserSchema` — the same schema the endpoint
 * validates with — so the message about a short password is written once.
 */
export function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { can } = usePermissions();
  const canAssignRoles = can('administration.roles.assign');
  const rolesQuery = useRoles();
  const createUser = useCreateUser();

  function reset() {
    setForm(EMPTY);
    setRoleIds([]);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Cleared on close, not on open: a dialog that reopens holding a
    // half-typed previous attempt is a way to create the wrong user.
    if (!next) reset();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createUserSchema.safeParse({ ...form, roleIds });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisá los datos ingresados.');
      return;
    }

    try {
      await createUser.mutateAsync(parsed.data);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.');
    }
  }

  const roles = (rolesQuery.data?.roles ?? []).filter((role) => role.active);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Nuevo usuario
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogTitle>Nuevo usuario</DialogTitle>
          <DialogDescription>
            Se crea con acceso a la empresa activa. Entregale la contraseña en persona: el sistema no envía
            mails.
          </DialogDescription>

          <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="user-first-name">Nombre</Label>
                <Input
                  id="user-first-name"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  autoFocus
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="user-last-name">Apellido</Label>
                <Input
                  id="user-last-name"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-password">Contraseña inicial</Label>
              <Input
                id="user-password"
                type="password"
                // Off, not "new-password": the browser would offer to save this
                // under the administrator's own account, which is not whose
                // password it is.
                autoComplete="off"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
              <p className="text-xs text-muted-foreground">
                Mínimo {PASSWORD_MIN_LENGTH} caracteres. El usuario puede cambiarla después.
              </p>
            </div>

            {canAssignRoles && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-[0.8125rem] leading-4 font-semibold">Roles</legend>
                {rolesQuery.isLoading ? (
                  <div className="h-16 animate-pulse rounded-md bg-muted" aria-label="Cargando roles" />
                ) : roles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay roles activos en esta empresa.</p>
                ) : (
                  <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
                    {roles.map((role) => (
                      <label key={role.id} className="flex items-center gap-2 text-sm font-normal">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-border"
                          checked={roleIds.includes(role.id)}
                          onChange={(e) =>
                            setRoleIds((ids) =>
                              e.target.checked ? [...ids, role.id] : ids.filter((id) => id !== role.id),
                            )
                          }
                        />
                        {role.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={createUser.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? 'Creando…' : 'Crear usuario'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
