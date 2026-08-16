'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { pricingModeLabel } from '@erp/shared';
import { usePermissions, usePriceLists, useDeactivatePriceList, useReactivatePriceList } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Listas de precios</h1>
          <p className="text-sm text-muted-foreground">
            Precios de venta por lista — Minorista, Mayorista, Distribuidor, etc. Los productos no tienen un
            precio propio: cada precio pertenece a una lista.
          </p>
        </div>
        {canCreate && (
          <Link href="/listas-de-precios/nueva" className={buttonVariants()}>
            <Plus className="size-4" />
            Nueva lista
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
              <th className="px-4 py-2">Moneda</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Incluye impuestos</th>
              <th className="px-4 py-2">Predeterminada</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {priceLists.map((pl) => (
              <tr key={pl.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{pl.code}</td>
                <td className="px-4 py-2 font-medium">
                  <Link href={`/listas-de-precios/${pl.id}`} className="underline-offset-4 hover:underline">
                    {pl.name}
                  </Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{pl.currencyCode}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {pricingModeLabel(pl.pricingMode)}
                  {pl.pricingMode === 'DERIVED' && pl.basePriceListName && (
                    <span className="text-xs text-muted-foreground"> ({pl.basePriceListName})</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <BoolCell value={pl.includesTax} />
                </td>
                <td className="px-4 py-2">
                  <BoolCell value={pl.isDefault} />
                </td>
                <td className="px-4 py-2">
                  {pl.active ? (
                    <span className="text-emerald-600">Activa</span>
                  ) : (
                    <span className="text-muted-foreground">Inactiva</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
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
            {!priceListsQuery.isLoading && priceLists.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay listas de precios.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
