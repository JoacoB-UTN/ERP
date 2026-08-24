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
import { stockErrorMessage } from '@/components/stock/stock-errors';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';

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
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Depósitos"
        meta={`${warehouses.length} ${warehouses.length === 1 ? 'depósito' : 'depósitos'}`}
        actions={canCreate && (
          <Link href="/stock/depositos/nuevo" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Nuevo depósito
          </Link>
        )}
      />

      {error && <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-muted px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Código</th>
              <th className="px-3 py-1.5">Nombre</th>
              <th className="px-3 py-1.5">Sucursal</th>
              <th className="px-3 py-1.5">Ventas</th>
              <th className="px-3 py-1.5">Compras</th>
              <th className="px-3 py-1.5">Stock negativo</th>
              <th className="px-3 py-1.5">Estado</th>
              {(canUpdate || canDeactivate) && <th className="px-3 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {warehousesQuery.isLoading && <TableRowsSkeleton columns={canUpdate || canDeactivate ? 8 : 7} />}
            {warehouses.map((w) => (
              <tr key={w.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{w.code}</td>
                <td className="px-3 py-1 font-medium">{w.name}</td>
                <td className="px-3 py-1 whitespace-nowrap">{w.branchName ?? '—'}</td>
                <td className="px-3 py-1">
                  <BoolCell value={w.allowsSales} />
                </td>
                <td className="px-3 py-1">
                  <BoolCell value={w.allowsPurchases} />
                </td>
                <td className="px-3 py-1">
                  <BoolCell value={w.allowNegativeStock} />
                </td>
                <td className="px-3 py-1">
                  <StatusBadge status={w.status}>{w.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</StatusBadge>
                </td>
                {(canUpdate || canDeactivate) && (
                  <td className="px-3 py-1 text-right">
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
            {warehousesQuery.isError && (
              <TableMessage
                columns={canUpdate || canDeactivate ? 8 : 7}
                kind="error"
                title="No pudimos cargar los depósitos"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => warehousesQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!warehousesQuery.isLoading && !warehousesQuery.isError && warehouses.length === 0 && (
              <TableMessage
                columns={canUpdate || canDeactivate ? 8 : 7}
                title="Todavía no hay depósitos"
                description="Creá una ubicación para empezar a registrar stock."
                action={canCreate && (
                  <Link href="/stock/depositos/nuevo" className={buttonVariants()}>
                    <Plus className="size-4" />
                    Nuevo depósito
                  </Link>
                )}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
