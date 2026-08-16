'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@erp/auth-client';
import { usePermissions, useCreateRole } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Unauthorized } from '@/components/layout/unauthorized';

export default function NewRolePage() {
  const router = useRouter();
  const { can, isLoading } = usePermissions();
  const createRole = useCreateRole();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return null;
  }
  if (!can('administration.roles.create')) {
    return <Unauthorized />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await createRole.mutateAsync({ name, description: description || undefined });
      router.push(`/administracion/roles/${result.role.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el rol.');
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nuevo rol</h1>
        <p className="text-sm text-muted-foreground">Después de crearlo vas a poder elegir sus permisos.</p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Descripción</Label>
          <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={createRole.isPending}>
          {createRole.isPending ? 'Creando…' : 'Crear rol'}
        </Button>
      </form>
    </div>
  );
}
