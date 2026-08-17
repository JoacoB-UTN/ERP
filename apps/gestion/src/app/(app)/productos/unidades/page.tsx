'use client';

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { UnitOfMeasureDto } from '@erp/shared';
import { usePermissions, useUnits, useCreateUnit, useUpdateUnit, useDeactivateUnit } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Unauthorized } from '@/components/layout/unauthorized';
import { ProductosSubNav } from '@/components/productos/productos-sub-nav';
import { PageHeader } from '@/components/ui/page-header';

interface UnitDraft {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: string;
}

function emptyDraft(): UnitDraft {
  return { code: '', name: '', symbol: '', decimalPlaces: '0' };
}

export default function UnidadesPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const unitsQuery = useUnits();
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit();
  const deactivateUnit = useDeactivateUnit();

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<UnitDraft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<UnitDraft>(emptyDraft());

  if (permissionsLoading) {
    return null;
  }
  if (!can('products.read')) {
    return <Unauthorized />;
  }
  const canCreate = can('products.create');
  const canUpdate = can('products.update');

  async function submitCreate() {
    await createUnit.mutateAsync({
      code: draft.code,
      name: draft.name,
      symbol: draft.symbol,
      decimalPlaces: Number(draft.decimalPlaces) || 0,
    });
    setCreating(false);
    setDraft(emptyDraft());
  }
  function startEdit(unit: UnitOfMeasureDto) {
    setEditingId(unit.id);
    setEditDraft({ code: unit.code, name: unit.name, symbol: unit.symbol, decimalPlaces: String(unit.decimalPlaces) });
  }
  async function submitEdit(id: string) {
    await updateUnit.mutateAsync({
      id,
      input: {
        code: editDraft.code,
        name: editDraft.name,
        symbol: editDraft.symbol,
        decimalPlaces: Number(editDraft.decimalPlaces) || 0,
      },
    });
    setEditingId(null);
  }
  async function handleDeactivate(id: string, name: string) {
    if (!window.confirm(`¿Desactivar la unidad "${name}"? Los productos que ya la usan seguirán funcionando.`)) return;
    await deactivateUnit.mutateAsync(id);
  }

  const units = unitsQuery.data?.units ?? [];

  return (
    <div className="flex flex-col gap-6">
      <ProductosSubNav />
      <PageHeader
        title="Unidades de medida"
        description="Unidades y precisión usadas por los productos; desactivar una no modifica registros existentes."
        actions={canCreate && (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Nueva unidad
          </Button>
        )}
      />

      {creating && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Código</label>
            <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} className="w-24" autoFocus />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Nombre</label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Símbolo</label>
            <Input value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} className="w-20" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Decimales</label>
            <Input
              type="number"
              min="0"
              max="6"
              value={draft.decimalPlaces}
              onChange={(e) => setDraft({ ...draft, decimalPlaces: e.target.value })}
              className="w-20"
            />
          </div>
          <Button size="sm" onClick={submitCreate} disabled={!draft.code || !draft.name || !draft.symbol || createUnit.isPending}>
            Guardar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
            Cancelar
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Símbolo</th>
              <th className="px-4 py-2">Decimales</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {units.map((unit) =>
              editingId === unit.id ? (
                <tr key={unit.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <Input value={editDraft.code} onChange={(e) => setEditDraft({ ...editDraft, code: e.target.value })} className="w-20" />
                  </td>
                  <td className="px-4 py-2">
                    <Input value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className="w-36" />
                  </td>
                  <td className="px-4 py-2">
                    <Input value={editDraft.symbol} onChange={(e) => setEditDraft({ ...editDraft, symbol: e.target.value })} className="w-16" />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number"
                      min="0"
                      max="6"
                      value={editDraft.decimalPlaces}
                      onChange={(e) => setEditDraft({ ...editDraft, decimalPlaces: e.target.value })}
                      className="w-16"
                    />
                  </td>
                  <td className="px-4 py-2">{unit.active ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" onClick={() => submitEdit(unit.id)} disabled={updateUnit.isPending}>
                        Guardar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={unit.id} className="border-t border-border">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{unit.code}</td>
                  <td className="px-4 py-2">{unit.name}</td>
                  <td className="px-4 py-2">{unit.symbol}</td>
                  <td className="px-4 py-2">{unit.decimalPlaces}</td>
                  <td className="px-4 py-2">
                    {unit.active ? (
                      <span className="text-emerald-600">Activo</span>
                    ) : (
                      <span className="text-muted-foreground">Inactivo</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canUpdate && (
                      <div className="flex justify-end gap-1">
                        <Button type="button" size="icon-sm" variant="ghost" onClick={() => startEdit(unit)}>
                          <Pencil className="size-4" />
                        </Button>
                        {unit.active && (
                          <Button type="button" size="sm" variant="outline" onClick={() => handleDeactivate(unit.id, unit.name)}>
                            Desactivar
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ),
            )}
            {units.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay unidades de medida.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
