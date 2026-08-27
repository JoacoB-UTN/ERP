'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  DirectReceiptLineEditor,
  OrderReceiptLineEditor,
  toPurchaseReceiptLineInputs,
  type PurchaseReceiptLineDraft,
} from '@/components/compras/purchase-receipt-line-editor';
import { purchaseErrorMessage } from '@/components/compras/purchases-errors';
import {
  usePermissions,
  useWarehouses,
  useCurrencies,
  usePurchaseOrder,
  useCreatePurchaseReceipt,
} from '@/lib/auth-client';

export default function NuevaRecepcionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const purchaseOrderId = searchParams.get('purchaseOrderId');

  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();
  const currenciesQuery = useCurrencies();
  const orderQuery = usePurchaseOrder(purchaseOrderId);
  const createPurchaseReceipt = useCreatePurchaseReceipt();

  const [supplier, setSupplier] = useState<SupplierPickerSelection | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [receiptDate, setReceiptDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseReceiptLineDraft[]>([]);
  const [error, setError] = useState<string | undefined>();

  if (permissionsLoading || (purchaseOrderId && orderQuery.isLoading)) {
    return null;
  }
  if (!can('purchases.goods-receipts.create')) {
    return <Unauthorized />;
  }
  if (purchaseOrderId && !orderQuery.data) {
    return <p className="text-muted-foreground">No se encontró la orden de compra.</p>;
  }

  const order = orderQuery.data?.purchaseOrder ?? null;
  const eligibleWarehouses = (warehousesQuery.data?.warehouses ?? []).filter(
    (w) => w.status === 'ACTIVE' && w.allowsPurchases,
  );
  const activeCurrencies = (currenciesQuery.data?.currencies ?? []).filter((c) => c.active);
  const currencyCode = order
    ? order.currencyCode
    : (activeCurrencies.find((c) => c.id === currencyId)?.code ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const supplierId = order ? order.supplier.id : supplier?.supplierId;
    if (!supplierId) {
      setError('Elegí un proveedor.');
      return;
    }
    if (!warehouseId) {
      setError('Elegí un depósito.');
      return;
    }
    if (!order && !currencyId) {
      setError('Elegí una moneda.');
      return;
    }
    if (lines.length === 0) {
      setError('Agregá al menos una línea.');
      return;
    }
    if (
      lines.some(
        (l) => !l.quantity || Number(l.quantity) <= 0 || !l.unitCostSnapshot || Number(l.unitCostSnapshot) < 0,
      )
    ) {
      setError('Todas las líneas necesitan una cantidad mayor a cero y un costo unitario válido.');
      return;
    }
    try {
      const result = await createPurchaseReceipt.mutateAsync({
        supplierId,
        warehouseId,
        purchaseOrderId: order?.id,
        currencyId: order ? undefined : currencyId,
        receiptDate: receiptDate ? new Date(receiptDate) : undefined,
        notes: notes || undefined,
        lines: toPurchaseReceiptLineInputs(lines),
      });
      router.push(`/compras/recepciones/${result.purchaseReceipt.id}`);
    } catch (err) {
      setError(purchaseErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={handleSubmit} className="flex max-w-5xl flex-col gap-6" noValidate>
        <PageHeader
          title="Nueva recepción"
          description={
            order
              ? `Recibiendo mercadería de la orden ${order.number}. Se guarda como borrador; el stock se actualiza al confirmarla.`
              : 'Recepción directa, sin orden de compra. Se guarda como borrador; el stock se actualiza al confirmarla.'
          }
          backHref={order ? `/compras/ordenes/${order.id}` : '/compras/recepciones'}
          backLabel={order ? order.number : 'Recepciones'}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="supplier">Proveedor</Label>
            {order ? (
              <p className="h-(--control-height) text-sm leading-(--control-height)">{order.supplier.legalName}</p>
            ) : (
              <SupplierPicker value={supplier} onSelect={setSupplier} />
            )}
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
          {order ? (
            <div className="flex flex-col gap-1.5">
              <Label>Moneda</Label>
              <p className="h-(--control-height) text-sm leading-(--control-height)">{order.currencyCode}</p>
            </div>
          ) : (
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
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="receiptDate">Fecha de recepción (opcional)</Label>
            <Input id="receiptDate" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notas (opcional)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Líneas</Label>
          {order ? (
            <OrderReceiptLineEditor
              currencyCode={currencyCode || '—'}
              orderLines={order.lines}
              lines={lines}
              onChange={setLines}
            />
          ) : (
            <DirectReceiptLineEditor currencyCode={currencyCode || '—'} lines={lines} onChange={setLines} />
          )}
        </div>

        <FieldError message={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={createPurchaseReceipt.isPending}>
            {createPurchaseReceipt.isPending ? 'Guardando…' : 'Guardar borrador'}
          </Button>
        </div>
      </form>
    </div>
  );
}
