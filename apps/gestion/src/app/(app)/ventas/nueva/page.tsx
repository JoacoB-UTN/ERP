'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { Unauthorized } from '@/components/layout/unauthorized';
import { CustomerPicker, type CustomerPickerSelection } from '@/components/sales/customer-picker';
import { SaleLineEditor, toSaleLineInputs, type SaleLineDraft } from '@/components/sales/sale-line-editor';
import { saleErrorMessage } from '@/components/sales/sales-errors';
import { usePermissions, useWarehouses, usePriceLists, useActiveBranchId, useCreateSale } from '@/lib/auth-client';

export default function NuevaVentaPage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();
  const priceListsQuery = usePriceLists();
  const activeBranchId = useActiveBranchId();
  const createSale = useCreateSale();

  const [customer, setCustomer] = useState<CustomerPickerSelection | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [priceListId, setPriceListId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<SaleLineDraft[]>([]);
  const [error, setError] = useState<string | undefined>();

  if (permissionsLoading) {
    return null;
  }
  if (!can('sales.documents.create')) {
    return <Unauthorized />;
  }

  // Gestión has no branch-scoped session today (unlike Facturación) — every ACTIVE,
  // sales-enabled warehouse is offered regardless of its own branchId. See docs/sales.md.
  const eligibleWarehouses = (warehousesQuery.data?.warehouses ?? []).filter(
    (w) => w.status === 'ACTIVE' && w.allowsSales,
  );
  const activePriceLists = (priceListsQuery.data?.priceLists ?? []).filter((p) => p.active);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!customer) {
      setError('Elegí un cliente.');
      return;
    }
    if (!warehouseId) {
      setError('Elegí un depósito.');
      return;
    }
    if (!priceListId) {
      setError('Elegí una lista de precios.');
      return;
    }
    if (lines.length === 0) {
      setError('Agregá al menos una línea.');
      return;
    }
    if (lines.some((l) => !l.quantity || Number(l.quantity) <= 0)) {
      setError('Todas las líneas necesitan una cantidad mayor a cero.');
      return;
    }
    try {
      const result = await createSale.mutateAsync({
        customerId: customer.customerId,
        warehouseId,
        priceListId,
        branchId: activeBranchId ?? undefined,
        notes: notes || undefined,
        lines: toSaleLineInputs(lines),
      });
      router.push(`/ventas/${result.salesDocument.id}`);
    } catch (err) {
      setError(saleErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/ventas" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Volver a ventas
      </Link>

      <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nueva venta</h1>
          <p className="text-sm text-muted-foreground">
            Se guarda como borrador — no afecta el stock hasta que la confirmes.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer">Cliente</Label>
            <CustomerPicker value={customer} onSelect={setCustomer} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="warehouse">Depósito</Label>
            <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              <option value="">Elegí un depósito…</option>
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
              <option value="">Elegí una lista…</option>
              {activePriceLists.map((p) => (
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
          <Button type="submit" disabled={createSale.isPending}>
            {createSale.isPending ? 'Guardando…' : 'Guardar borrador'}
          </Button>
        </div>
      </form>
    </div>
  );
}
