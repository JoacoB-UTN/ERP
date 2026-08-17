'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { stockErrorMessage } from '@/components/stock/stock-errors';
import { usePermissions, useActiveCompany, useBranches, useCreateWarehouse } from '@/lib/auth-client';

export default function NuevoDepositoPage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const { activeCompanyId } = useActiveCompany();
  const branchesQuery = useBranches(activeCompanyId);
  const createWarehouse = useCreateWarehouse();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [branchId, setBranchId] = useState('');
  const [allowsSales, setAllowsSales] = useState(true);
  const [allowsPurchases, setAllowsPurchases] = useState(true);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.warehouses.create')) {
    return <Unauthorized />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      const result = await createWarehouse.mutateAsync({
        code,
        name,
        description: description || undefined,
        branchId: branchId || undefined,
        allowsSales,
        allowsPurchases,
        allowNegativeStock,
      });
      router.push(`/stock/depositos/${result.warehouse.id}/editar`);
    } catch (err) {
      setError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6" noValidate>
        <PageHeader
          title="Nuevo depósito"
          description="Configurá una ubicación física y sus reglas operativas."
          backHref="/stock/depositos"
          backLabel="Depósitos"
        />

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
            {branchesQuery.data?.branches.map((b) => (
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

        <div className="flex gap-2">
          <Button type="submit" disabled={createWarehouse.isPending}>
            {createWarehouse.isPending ? 'Guardando…' : 'Crear depósito'}
          </Button>
        </div>
      </form>
    </div>
  );
}
