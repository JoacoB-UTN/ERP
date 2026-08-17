'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { StockAdjustmentDetail } from '@erp/shared';
import { usePermissions, useStockAdjustment, useWarehouses, useUpdateStockAdjustment } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import {
  AdjustmentLineEditor,
  toAdjustmentLineInputs,
  type AdjustmentLineDraft,
} from '@/components/stock/adjustment-line-editor';
import { stockErrorMessage } from '@/components/stock/stock-errors';

function toDrafts(adjustment: StockAdjustmentDetail): AdjustmentLineDraft[] {
  return adjustment.lines.map((line) => {
    const signed = Number(line.quantityDelta);
    return {
      key: line.id,
      variantId: line.productVariantId,
      label: line.variantName ? `${line.productName} · ${line.variantName}` : line.productName,
      sku: line.sku,
      direction: signed < 0 ? 'OUT' : 'IN',
      quantity: String(Math.abs(signed)),
      reason: line.reason ?? '',
    };
  });
}

export default function EditarAjustePage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const adjustmentQuery = useStockAdjustment(id ?? null);
  const warehousesQuery = useWarehouses();

  if (permissionsLoading || adjustmentQuery.isLoading || warehousesQuery.isLoading) {
    return null;
  }
  const adjustment = adjustmentQuery.data?.adjustment;
  if (!can('inventory.adjustments.create') || !adjustment) {
    return <Unauthorized />;
  }
  if (adjustment.status !== 'DRAFT') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">Solo se pueden editar ajustes en borrador.</p>
        <Link href={`/stock/ajustes/${adjustment.id}`} className="w-fit text-sm underline-offset-4 hover:underline">
          Volver al ajuste
        </Link>
      </div>
    );
  }

  return (
    <EditarAjusteForm
      key={adjustment.id}
      adjustment={adjustment}
      warehouses={warehousesQuery.data?.warehouses ?? []}
    />
  );
}

function EditarAjusteForm({
  adjustment,
  warehouses,
}: {
  adjustment: StockAdjustmentDetail;
  warehouses: { id: string; name: string; status: string }[];
}) {
  const router = useRouter();
  const updateAdjustment = useUpdateStockAdjustment();

  const [warehouseId, setWarehouseId] = useState(adjustment.warehouseId);
  const [reason, setReason] = useState(adjustment.reason);
  const [notes, setNotes] = useState(adjustment.notes ?? '');
  const [lines, setLines] = useState<AdjustmentLineDraft[]>(toDrafts(adjustment));
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!warehouseId) {
      setError('Elegí un depósito.');
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
      await updateAdjustment.mutateAsync({
        id: adjustment.id,
        input: {
          warehouseId,
          reason,
          notes: notes || null,
          lines: toAdjustmentLineInputs(lines),
        },
      });
      router.push(`/stock/ajustes/${adjustment.id}`);
    } catch (err) {
      setError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/stock/ajustes/${adjustment.id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver al ajuste
      </Link>

      <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
        <PageHeader
          title={`Editar ${adjustment.number}`}
          description="Sigue siendo un borrador; todavía no afecta el stock."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="warehouse">Depósito</Label>
            <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              {warehouses
                .filter((w) => w.status === 'ACTIVE' || w.id === warehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notas (opcional)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Líneas</Label>
          <AdjustmentLineEditor warehouseId={warehouseId || null} lines={lines} onChange={setLines} />
        </div>

        <FieldError message={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={updateAdjustment.isPending}>
            {updateAdjustment.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </div>
  );
}
