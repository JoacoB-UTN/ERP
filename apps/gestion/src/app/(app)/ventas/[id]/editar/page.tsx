'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SalesDocumentDetailDto } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { SaleLineEditor, toSaleLineInputs, type SaleLineDraft } from '@/components/sales/sale-line-editor';
import { saleErrorMessage } from '@/components/sales/sales-errors';
import { usePermissions, useSale, useWarehouses, usePriceLists, useUpdateSale } from '@/lib/auth-client';

function toDrafts(sale: SalesDocumentDetailDto): SaleLineDraft[] {
  return sale.lines.map((line) => ({
    key: line.id,
    variantId: line.productVariantId,
    label: line.variantName ? `${line.description}` : line.description,
    sku: line.sku,
    productType: 'PRODUCT',
    quantity: line.quantity,
    discountPercentage: line.discountPercentage,
  }));
}

export default function EditarVentaPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const saleQuery = useSale(id ?? null);
  const warehousesQuery = useWarehouses();
  const priceListsQuery = usePriceLists();

  if (permissionsLoading || saleQuery.isLoading || warehousesQuery.isLoading || priceListsQuery.isLoading) {
    return null;
  }
  const sale = saleQuery.data?.salesDocument;
  if (!can('sales.documents.update') || !sale) {
    return <Unauthorized />;
  }
  if (sale.status !== 'DRAFT') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">Solo se pueden editar ventas en borrador.</p>
        <Link href={`/ventas/${sale.id}`} className="w-fit text-sm underline-offset-4 hover:underline">
          Volver a la venta
        </Link>
      </div>
    );
  }

  return (
    <EditarVentaForm
      key={sale.id}
      sale={sale}
      warehouses={warehousesQuery.data?.warehouses ?? []}
      priceLists={priceListsQuery.data?.priceLists ?? []}
    />
  );
}

function EditarVentaForm({
  sale,
  warehouses,
  priceLists,
}: {
  sale: SalesDocumentDetailDto;
  warehouses: { id: string; name: string; status: string; branchId: string | null; allowsSales: boolean }[];
  priceLists: { id: string; name: string; active: boolean }[];
}) {
  const router = useRouter();
  const updateSale = useUpdateSale();

  const [warehouseId, setWarehouseId] = useState(sale.warehouse.id);
  const [priceListId, setPriceListId] = useState(sale.priceList.id);
  const [notes, setNotes] = useState(sale.notes ?? '');
  const [lines, setLines] = useState<SaleLineDraft[]>(toDrafts(sale));
  const [error, setError] = useState<string | undefined>();

  // Gestión has no branch-scoped session today — see docs/sales.md and ventas/nueva/page.tsx.
  const eligibleWarehouses = warehouses.filter(
    (w) => w.id === warehouseId || (w.status === 'ACTIVE' && w.allowsSales),
  );
  const eligiblePriceLists = priceLists.filter((p) => p.id === priceListId || p.active);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (lines.length === 0) {
      setError('Agregá al menos una línea.');
      return;
    }
    if (lines.some((l) => !l.quantity || Number(l.quantity) <= 0)) {
      setError('Todas las líneas necesitan una cantidad mayor a cero.');
      return;
    }
    try {
      await updateSale.mutateAsync({
        id: sale.id,
        input: {
          warehouseId,
          priceListId,
          notes: notes || null,
          lines: toSaleLineInputs(lines),
        },
      });
      router.push(`/ventas/${sale.id}`);
    } catch (err) {
      setError(saleErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={handleSubmit} className="flex max-w-5xl flex-col gap-6" noValidate>
        <PageHeader
          title={`Editar ${sale.number}`}
          description="Sigue siendo un borrador; si cambiás la lista, todos los precios se vuelven a resolver."
          backHref={`/ventas/${sale.id}`}
          backLabel="Volver a la venta"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer">Cliente</Label>
            <p className="flex h-(--control-height) items-center text-sm text-muted-foreground">{sale.customer.legalName}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="warehouse">Depósito</Label>
            <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              {eligibleWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priceList">Lista de precios</Label>
            <Select id="priceList" value={priceListId} onChange={(e) => setPriceListId(e.target.value)} required>
              {eligiblePriceLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notas (opcional)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Líneas</Label>
          <SaleLineEditor
            warehouseId={warehouseId || null}
            priceListId={priceListId || null}
            lines={lines}
            onChange={setLines}
          />
        </div>

        <FieldError message={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={updateSale.isPending}>
            {updateSale.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </div>
  );
}
