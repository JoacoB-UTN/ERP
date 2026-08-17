'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight, Pencil, Plus } from 'lucide-react';
import type { ProductCategoryDto } from '@erp/shared';
import {
  usePermissions,
  useProductCategories,
  useCreateProductCategory,
  useUpdateProductCategory,
  useDeactivateProductCategory,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Unauthorized } from '@/components/layout/unauthorized';
import { ProductosSubNav } from '@/components/productos/productos-sub-nav';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

export default function CategoriasPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const categoriesQuery = useProductCategories();
  const createCategory = useCreateProductCategory();
  const updateCategory = useUpdateProductCategory();
  const deactivateCategory = useDeactivateProductCategory();

  // undefined = no create form open; null = creating a root category; a string = creating a child of that category.
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (permissionsLoading) {
    return null;
  }
  if (!can('products.read')) {
    return <Unauthorized />;
  }
  const canCreate = can('products.create');
  const canUpdate = can('products.update');

  const categories = categoriesQuery.data?.categories ?? [];
  const childrenOf = (parentId: string | null) =>
    categories.filter((c) => c.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));

  function openCreate(parentId: string | null) {
    setCreatingParentId(parentId);
    setDraftName('');
    setDraftDescription('');
  }
  function cancelCreate() {
    setCreatingParentId(undefined);
    setDraftName('');
    setDraftDescription('');
  }
  async function submitCreate() {
    await createCategory.mutateAsync({
      parentId: creatingParentId ?? undefined,
      name: draftName,
      description: draftDescription || undefined,
    });
    cancelCreate();
  }
  function startEdit(category: ProductCategoryDto) {
    setEditingId(category.id);
    setEditName(category.name);
    setEditDescription(category.description ?? '');
  }
  async function submitEdit(id: string) {
    await updateCategory.mutateAsync({ id, input: { name: editName, description: editDescription || null } });
    setEditingId(null);
  }
  async function handleDeactivate(id: string, name: string) {
    if (!window.confirm(`¿Desactivar la categoría "${name}"?`)) return;
    await deactivateCategory.mutateAsync(id);
  }
  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderCreateForm(): ReactNode {
    return (
      <div className="flex gap-2 rounded-lg border border-dashed border-border p-2">
        <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Nombre" autoFocus className="flex-1" />
        <Input
          value={draftDescription}
          onChange={(e) => setDraftDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          className="flex-1"
        />
        <Button size="sm" onClick={submitCreate} disabled={!draftName || createCategory.isPending}>
          Guardar
        </Button>
        <Button size="sm" variant="outline" onClick={cancelCreate}>
          Cancelar
        </Button>
      </div>
    );
  }

  function renderNode(category: ProductCategoryDto, depth: number): ReactNode {
    const children = childrenOf(category.id);
    const isCollapsed = collapsed.has(category.id);
    const isEditing = editingId === category.id;

    return (
      <div key={category.id} className="flex flex-col gap-2">
        <div className="flex items-center gap-2" style={{ marginLeft: depth * 24 }}>
          {children.length > 0 ? (
            <button type="button" onClick={() => toggleCollapse(category.id)} className="shrink-0">
              <ChevronRight className={cn('size-4 transition-transform', !isCollapsed && 'rotate-90')} />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {isEditing ? (
            <div className="flex flex-1 items-center gap-2">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" />
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Descripción"
                className="flex-1"
              />
              <Button size="sm" onClick={() => submitEdit(category.id)} disabled={!editName || updateCategory.isPending}>
                Guardar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">
                  {category.name}
                  {!category.active && <span className="ml-1.5 text-xs text-muted-foreground">(inactiva)</span>}
                </p>
                {category.description && <p className="text-xs text-muted-foreground">{category.description}</p>}
              </div>
              {canUpdate && (
                <div className="flex shrink-0 gap-1">
                  {canCreate && (
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => openCreate(category.id)}>
                      <Plus className="size-4" />
                    </Button>
                  )}
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => startEdit(category)}>
                    <Pencil className="size-4" />
                  </Button>
                  {category.active && (
                    <Button type="button" size="sm" variant="outline" onClick={() => handleDeactivate(category.id, category.name)}>
                      Desactivar
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {creatingParentId === category.id && <div style={{ marginLeft: (depth + 1) * 24 }}>{renderCreateForm()}</div>}
        {!isCollapsed && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const roots = childrenOf(null);

  return (
    <div className="flex flex-col gap-6">
      <ProductosSubNav />
      <PageHeader
        title="Categorías"
        description="Organizá el catálogo en una jerarquía clara y navegable."
        actions={canCreate && (
          <Button type="button" onClick={() => openCreate(null)}>
            <Plus className="size-4" />
            Nueva categoría
          </Button>
        )}
      />

      {creatingParentId === null && renderCreateForm()}

      <div className="flex flex-col gap-2">
        {roots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay categorías.</p>
        ) : (
          roots.map((r) => renderNode(r, 0))
        )}
      </div>
    </div>
  );
}
