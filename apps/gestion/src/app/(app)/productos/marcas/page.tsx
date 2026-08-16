'use client';

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { BrandDto } from '@erp/shared';
import { usePermissions, useBrands, useCreateBrand, useUpdateBrand, useDeactivateBrand } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Unauthorized } from '@/components/layout/unauthorized';
import { ProductosSubNav } from '@/components/productos/productos-sub-nav';

export default function MarcasPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const brandsQuery = useBrands();
  const createBrand = useCreateBrand();
  const updateBrand = useUpdateBrand();
  const deactivateBrand = useDeactivateBrand();

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
    await createBrand.mutateAsync({ name: draftName, description: draftDescription || undefined });
    setCreating(false);
    setDraftName('');
    setDraftDescription('');
  }
  function startEdit(brand: BrandDto) {
    setEditingId(brand.id);
    setEditName(brand.name);
    setEditDescription(brand.description ?? '');
  }
  async function submitEdit(id: string) {
    await updateBrand.mutateAsync({ id, input: { name: editName, description: editDescription || null } });
    setEditingId(null);
  }
  async function handleDeactivate(id: string, name: string) {
    if (!window.confirm(`¿Desactivar la marca "${name}"?`)) return;
    await deactivateBrand.mutateAsync(id);
  }

  const brands = brandsQuery.data?.brands ?? [];

  return (
    <div className="flex flex-col gap-6">
      <ProductosSubNav />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marcas</h1>
          <p className="text-sm text-muted-foreground">Marcas usadas en el catálogo de productos.</p>
        </div>
        {canCreate && (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Nueva marca
          </Button>
        )}
      </div>

      {creating && (
        <div className="flex gap-2 rounded-lg border border-dashed border-border p-2">
          <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Nombre" autoFocus className="flex-1" />
          <Input
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Descripción (opcional)"
            className="flex-1"
          />
          <Button size="sm" onClick={submitCreate} disabled={!draftName || createBrand.isPending}>
            Guardar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
            Cancelar
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Marca</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) => (
              <tr key={brand.id} className="border-t border-border">
                <td className="px-4 py-2">
                  {editingId === brand.id ? (
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
                      <p className="font-medium">{brand.name}</p>
                      {brand.description && <p className="text-xs text-muted-foreground">{brand.description}</p>}
                    </>
                  )}
                </td>
                <td className="px-4 py-2">
                  {brand.active ? (
                    <span className="text-emerald-600">Activo</span>
                  ) : (
                    <span className="text-muted-foreground">Inactivo</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {canUpdate &&
                    (editingId === brand.id ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => submitEdit(brand.id)} disabled={!editName || updateBrand.isPending}>
                          Guardar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button type="button" size="icon-sm" variant="ghost" onClick={() => startEdit(brand)}>
                          <Pencil className="size-4" />
                        </Button>
                        {brand.active && (
                          <Button type="button" size="sm" variant="outline" onClick={() => handleDeactivate(brand.id, brand.name)}>
                            Desactivar
                          </Button>
                        )}
                      </div>
                    ))}
                </td>
              </tr>
            ))}
            {brands.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay marcas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
