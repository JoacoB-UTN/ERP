'use client';

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { ProductLineDto } from '@erp/shared';
import { usePermissions, useProductLines, useCreateProductLine, useUpdateProductLine, useDeactivateProductLine } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Unauthorized } from '@/components/layout/unauthorized';
import { ProductosSubNav } from '@/components/productos/productos-sub-nav';
import { PageHeader } from '@/components/ui/page-header';

export default function LineasPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const linesQuery = useProductLines();
  const createProductLine = useCreateProductLine();
  const updateProductLine = useUpdateProductLine();
  const deactivateProductLine = useDeactivateProductLine();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  if (permissionsLoading) {
    return null;
  }
  if (!can('products.read')) {
    return <Unauthorized />;
  }
  const canCreate = can('products.create');
  const canUpdate = can('products.update');

  async function submitCreate() {
    await createProductLine.mutateAsync({ name: draftName, description: draftDescription || undefined });
    setCreating(false);
    setDraftName('');
    setDraftDescription('');
  }
  function startEdit(line: ProductLineDto) {
    setEditingId(line.id);
    setEditName(line.name);
    setEditDescription(line.description ?? '');
  }
  async function submitEdit(id: string) {
    await updateProductLine.mutateAsync({ id, input: { name: editName, description: editDescription || null } });
    setEditingId(null);
  }
  async function handleDeactivate(id: string, name: string) {
    if (!window.confirm(`¿Desactivar la línea "${name}"?`)) return;
    await deactivateProductLine.mutateAsync(id);
  }

  const lines = linesQuery.data?.lines ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      <ProductosSubNav />
      <PageHeader
        title="Líneas"
        description="Líneas disponibles para clasificar el catálogo de productos."
        actions={canCreate && (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Nueva línea
          </Button>
        )}
      />

      {creating && (
        <div className="flex gap-2 rounded-lg border border-dashed border-border p-2">
          <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Nombre" autoFocus className="flex-1" />
          <Input
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Descripción (opcional)"
            className="flex-1"
          />
          <Button size="sm" onClick={submitCreate} disabled={!draftName || createProductLine.isPending}>
            Guardar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
            Cancelar
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Línea</th>
              <th className="px-3 py-1.5">Estado</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1">
                  {editingId === line.id ? (
                    <div className="flex items-center gap-2">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-48" />
                      <Input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Descripción"
                        className="max-w-48"
                      />
                    </div>
                  ) : (
                    <>
                      <p className="font-medium">{line.name}</p>
                      {line.description && <p className="text-xs text-muted-foreground">{line.description}</p>}
                    </>
                  )}
                </td>
                <td className="px-3 py-1">
                  {line.active ? (
                    <span className="text-emerald-600">Activo</span>
                  ) : (
                    <span className="text-muted-foreground">Inactivo</span>
                  )}
                </td>
                <td className="px-3 py-1 text-right">
                  {canUpdate &&
                    (editingId === line.id ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => submitEdit(line.id)} disabled={!editName || updateProductLine.isPending}>
                          Guardar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button type="button" size="icon-sm" variant="ghost" onClick={() => startEdit(line)}>
                          <Pencil className="size-4" />
                        </Button>
                        {line.active && (
                          <Button type="button" size="sm" variant="outline" onClick={() => handleDeactivate(line.id, line.name)}>
                            Desactivar
                          </Button>
                        )}
                      </div>
                    ))}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay líneas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
