'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { pricingModeLabel } from '@erp/shared';
import { usePermissions, usePriceLists, useDeactivatePriceList, useReactivatePriceList } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';
import { Unauthorized } from '@/components/layout/unauthorized';
import { pricingErrorMessage } from '@/components/pricing/pricing-errors';

function BoolCell({ value }: { value: boolean }) {
  return <span className={value ? 'text-emerald-600' : 'text-muted-foreground'}>{value ? 'Sí' : 'No'}</span>;
}

export default function ListasDePreciosPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const priceListsQuery = usePriceLists();
  const deactivatePriceList = useDeactivatePriceList();
  const reactivatePriceList = useReactivatePriceList();
  const [error, setError] = useState<string | undefined>();

  if (permissionsLoading) {
    return null;
  }
  if (!can('pricing.lists.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('pricing.lists.create');
  const canDeactivate = can('pricing.lists.deactivate');
  const priceLists = priceListsQuery.data?.priceLists ?? [];

  async function handleDeactivate(id: string, name: string) {
    if (!window.confirm(`¿Desactivar la lista de precios "${name}"?`)) return;
    setError(undefined);
    try {
      await deactivatePriceList.mutateAsync(id);
    } catch (err) {
      setError(pricingErrorMessage(err));
    }
  }

  async function handleReactivate(id: string) {
    setError(undefined);
    try {
      await reactivatePriceList.mutateAsync(id);
    } catch (err) {
      setError(pricingErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader
        title="Listas de precios"
        meta={`${priceLists.length} ${priceLists.length === 1 ? 'lista' : 'listas'}`}
        actions={canCreate && (
          <Link href="/listas-de-precios/nueva" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Nueva lista
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
              <th className="px-3 py-1.5">Moneda</th>
              <th className="px-3 py-1.5">Tipo</th>
              <th className="px-3 py-1.5">Incluye impuestos</th>
              <th className="px-3 py-1.5">Predeterminada</th>
              <th className="px-3 py-1.5">Estado</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {priceListsQuery.isLoading && <TableRowsSkeleton columns={8} />}
            {priceLists.map((pl) => (
              <tr key={pl.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">{pl.code}</td>
                <td className="px-3 py-1 font-medium">
                  <Link href={`/listas-de-precios/${pl.id}`} className="underline-offset-4 hover:underline">
                    {pl.name}
                  </Link>
                </td>
                <td className="px-3 py-1 whitespace-nowrap">{pl.currencyCode}</td>
                <td className="px-3 py-1 whitespace-nowrap">
                  {pricingModeLabel(pl.pricingMode)}
                  {pl.pricingMode === 'DERIVED' && pl.basePriceListName && (
                    <span className="text-xs text-muted-foreground"> ({pl.basePriceListName})</span>
                  )}
                </td>
                <td className="px-3 py-1">
                  <BoolCell value={pl.includesTax} />
                </td>
                <td className="px-3 py-1">
                  <BoolCell value={pl.isDefault} />
                </td>
                <td className="px-3 py-1">
                  <StatusBadge status={pl.active ? 'ACTIVE' : 'INACTIVE'}>
                    {pl.active ? 'Activa' : 'Inactiva'}
                  </StatusBadge>
                </td>
                <td className="px-3 py-1 text-right">
                  {canDeactivate && (
                    <div className="flex justify-end gap-2">
                      {pl.active ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeactivate(pl.id, pl.name)}
                        >
                          Desactivar
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={() => handleReactivate(pl.id)}>
                          Reactivar
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {priceListsQuery.isError && (
              <TableMessage
                columns={8}
                kind="error"
                title="No pudimos cargar las listas de precios"
                description="Revisá la conexión e intentá nuevamente."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => priceListsQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            )}
            {!priceListsQuery.isLoading && !priceListsQuery.isError && priceLists.length === 0 && (
              <TableMessage
                columns={8}
                title="Todavía no hay listas de precios"
                description="Creá una lista fija o derivada para comenzar."
                action={canCreate && (
                  <Link href="/listas-de-precios/nueva" className={buttonVariants()}>
                    <Plus className="size-4" />
                    Nueva lista
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
