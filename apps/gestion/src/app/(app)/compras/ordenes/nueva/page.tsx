'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { SupplierPicker, type SupplierPickerSelection } from '@/components/compras/supplier-picker';
import {
  PurchaseOrderLineEditor,
  toPurchaseOrderLineInputs,
  type PurchaseOrderLineDraft,
} from '@/components/compras/purchase-order-line-editor';
import { purchaseErrorMessage } from '@/components/compras/purchases-errors';
import { usePermissions, useCurrencies, useCreatePurchaseOrder } from '@/lib/auth-client';

export default function NuevaOrdenDeCompraPage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const currenciesQuery = useCurrencies();
  const createPurchaseOrder = useCreatePurchaseOrder();

  const [supplier, setSupplier] = useState<SupplierPickerSelection | null>(null);
  const [currencyId, setCurrencyId] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseOrderLineDraft[]>([]);
  const [error, setError] = useState<string | undefined>();

  if (permissionsLoading) {
    return null;
  }
  if (!can('purchases.orders.create')) {
    return <Unauthorized />;
  }

  const activeCurrencies = (currenciesQuery.data?.currencies ?? []).filter((c) => c.active);
  const currencyCode = activeCurrencies.find((c) => c.id === currencyId)?.code ?? '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!supplier) {
      setError('Elegí un proveedor.');
      return;
    }
    if (!currencyId) {
      setError('Elegí una moneda.');
      return;
    }
    if (lines.length === 0) {
      setError('Agregá al menos una línea.');
      return;
    }
    if (lines.some((l) => !l.quantity || Number(l.quantity) <= 0 || !l.unitCost || Number(l.unitCost) < 0)) {
      setError('Todas las líneas necesitan una cantidad mayor a cero y un costo unitario válido.');
      return;
    }
    try {
      const result = await createPurchaseOrder.mutateAsync({
        supplierId: supplier.supplierId,
        currencyId,
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
        notes: notes || undefined,
        lines: toPurchaseOrderLineInputs(lines),
      });
      router.push(`/compras/ordenes/${result.purchaseOrder.id}`);
    } catch (err) {
      setError(purchaseErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={handleSubmit} className="flex max-w-5xl flex-col gap-6" noValidate>
        <PageHeader
          title="Nueva orden de compra"
          description="Se guarda como borrador; confirmarla no afecta el stock — solo la recepción de mercadería lo hace."
          backHref="/compras/ordenes"
          backLabel="Órdenes de compra"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="supplier">Proveedor</Label>
            <SupplierPicker value={supplier} onSelect={setSupplier} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currency">Moneda</Label>
            <Select id="currency" value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} required>
              <option value="">Elegí una moneda…</option>
              {activeCurrencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expectedDeliveryDate">Fecha estimada de entrega (opcional)</Label>
            <Input
              id="expectedDeliveryDate"
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notas (opcional)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Líneas</Label>
          <PurchaseOrderLineEditor currencyCode={currencyCode || '—'} lines={lines} onChange={setLines} />
        </div>

        <FieldError message={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={createPurchaseOrder.isPending}>
            {createPurchaseOrder.isPending ? 'Guardando…' : 'Guardar borrador'}
          </Button>
        </div>
      </form>
    </div>
  );
}
