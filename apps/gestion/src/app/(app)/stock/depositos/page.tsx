'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  usePermissions,
  useWarehouses,
  useDeactivateWarehouse,
  useReactivateWarehouse,
} from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { StockSubNav } from '@/components/stock/stock-sub-nav';
import { stockErrorMessage } from '@/components/stock/stock-errors';

function BoolCell({ value }: { value: boolean }) {
  return <span className={value ? 'text-emerald-600' : 'text-muted-foreground'}>{value ? 'Sí' : 'No'}</span>;
}

export default function DepositosPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();
  const deactivateWarehouse = useDeactivateWarehouse();
  const reactivateWarehouse = useReactivateWarehouse();
  const [error, setError] = useState<string | undefined>();

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.warehouses.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('inventory.warehouses.create');
  const canUpdate = can('inventory.warehouses.update');
  const canDeactivate = can('inventory.warehouses.deactivate');
  const warehouses = warehousesQuery.data?.warehouses ?? [];

  async function handleDeactivate(id: string, name: string) {
    if (!window.confirm(`¿Desactivar el depósito "${name}"?`)) return;
    setError(undefined);
    try {
      await deactivateWarehouse.mutateAsync(id);
    } catch (err) {
      setError(stockErrorMessage(err));
    }
  }

  async function handleReactivate(id: string) {
    setError(undefined);
    try {
      await reactivateWarehouse.mutateAsync(id);
    } catch (err) {
      setError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <StockSubNav />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Depósitos</h1>
          <p className="text-sm text-muted-foreground">Ubicaciones físicas donde se controla el stock.</p>
        </div>
        {canCreate && (
          <Link href="/stock/depositos/nuevo" className={buttonVariants()}>
            <Plus className="size-4" />
            Nuevo depósito
          </Link>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Sucursal</th>
              <th className="px-4 py-2">Ventas</th>
              <th className="px-4 py-2">Compras</th>
              <th className="px-4 py-2">Stock negativo</th>
              <th className="px-4 py-2">Estado</th>
              {(canUpdate || canDeactivate) && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {warehouses.map((w) => (
              <tr key={w.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{w.code}</td>
                <td className="px-4 py-2 font-medium">{w.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.branchName ?? '—'}</td>
                <td className="px-4 py-2">
                  <BoolCell value={w.allowsSales} />
                </td>
                <td className="px-4 py-2">
                  <BoolCell value={w.allowsPurchases} />
                </td>
                <td className="px-4 py-2">
                  <BoolCell value={w.allowNegativeStock} />
                </td>
                <td className="px-4 py-2">
                  {w.status === 'ACTIVE' ? (
                    <span className="text-emerald-600">Activo</span>
                  ) : (
                    <span className="text-muted-foreground">Inactivo</span>
                  )}
                </td>
                {(canUpdate || canDeactivate) && (
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {canUpdate && (
                        <Link
                          href={`/stock/depositos/${w.id}/editar`}
                          className="text-sm underline-offset-4 hover:underline"
                        >
                          Editar
                        </Link>
                      )}
                      {canDeactivate && w.status === 'ACTIVE' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeactivate(w.id, w.name)}
                        >
                          Desactivar
                        </Button>
                      )}
                      {canDeactivate && w.status === 'INACTIVE' && (
                        <Button type="button" size="sm" variant="outline" onClick={() => handleReactivate(w.id)}>
                          Reactivar
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!warehousesQuery.isLoading && warehouses.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay depósitos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
