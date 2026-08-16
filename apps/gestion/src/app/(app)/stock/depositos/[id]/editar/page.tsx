'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { WarehouseDto } from '@erp/shared';
import {
  usePermissions,
  useWarehouse,
  useActiveCompany,
  useBranches,
  useUpdateWarehouse,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { Unauthorized } from '@/components/layout/unauthorized';
import { StockSubNav } from '@/components/stock/stock-sub-nav';
import { stockErrorMessage } from '@/components/stock/stock-errors';

export default function EditarDepositoPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehouseQuery = useWarehouse(id ?? null);
  const { activeCompanyId } = useActiveCompany();
  const branchesQuery = useBranches(activeCompanyId);

  if (permissionsLoading || warehouseQuery.isLoading || branchesQuery.isLoading) {
    return null;
  }
  const warehouse = warehouseQuery.data?.warehouse;
  if (!can('inventory.warehouses.update') || !warehouse) {
    return <Unauthorized />;
  }

  return (
    <EditarDepositoForm
      key={warehouse.id}
      warehouse={warehouse}
      branches={branchesQuery.data?.branches ?? []}
    />
  );
}

function EditarDepositoForm({
  warehouse,
  branches,
}: {
  warehouse: WarehouseDto;
  branches: { id: string; name: string }[];
}) {
  const updateWarehouse = useUpdateWarehouse();

  const [code, setCode] = useState(warehouse.code);
  const [name, setName] = useState(warehouse.name);
  const [description, setDescription] = useState(warehouse.description ?? '');
  const [branchId, setBranchId] = useState(warehouse.branchId ?? '');
  const [allowsSales, setAllowsSales] = useState(warehouse.allowsSales);
  const [allowsPurchases, setAllowsPurchases] = useState(warehouse.allowsPurchases);
  const [allowNegativeStock, setAllowNegativeStock] = useState(warehouse.allowNegativeStock);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    try {
      await updateWarehouse.mutateAsync({
        id: warehouse.id,
        input: {
          code,
          name,
          description: description || null,
          branchId: branchId || null,
          allowsSales,
          allowsPurchases,
          allowNegativeStock,
        },
      });
      setSaved(true);
    } catch (err) {
      setError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <StockSubNav />
      <Link
        href="/stock/depositos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a depósitos
      </Link>

      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6" noValidate>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Editar {warehouse.name}</h1>
          <p className="text-sm text-muted-foreground">
            {warehouse.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Código</Label>
            <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={30} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Descripción (opcional)</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>

        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="branch">Sucursal (opcional)</Label>
          <Select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Sin sucursal específica</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowsSales} onChange={(e) => setAllowsSales(e.target.checked)} />
            Permite ventas — puede seleccionarse como origen de despacho
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowsPurchases} onChange={(e) => setAllowsPurchases(e.target.checked)} />
            Permite compras — puede seleccionarse como destino de recepción
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowNegativeStock}
              onChange={(e) => setAllowNegativeStock(e.target.checked)}
            />
            Permite stock negativo en este depósito
          </label>
        </div>

        <FieldError message={error} />
        {saved && !error && <p className="text-sm text-emerald-600">Cambios guardados.</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={updateWarehouse.isPending}>
            {updateWarehouse.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </div>
  );
}
