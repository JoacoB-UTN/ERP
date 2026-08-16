'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { Unauthorized } from '@/components/layout/unauthorized';
import { StockSubNav } from '@/components/stock/stock-sub-nav';
import {
  AdjustmentLineEditor,
  toAdjustmentLineInputs,
  type AdjustmentLineDraft,
} from '@/components/stock/adjustment-line-editor';
import { stockErrorMessage } from '@/components/stock/stock-errors';
import { usePermissions, useWarehouses, useCreateStockAdjustment } from '@/lib/auth-client';

export default function NuevoAjustePage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();
  const createAdjustment = useCreateStockAdjustment();

  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<AdjustmentLineDraft[]>([]);
  const [error, setError] = useState<string | undefined>();

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.adjustments.create')) {
    return <Unauthorized />;
  }

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
      const result = await createAdjustment.mutateAsync({
        warehouseId,
        reason,
        notes: notes || undefined,
        lines: toAdjustmentLineInputs(lines),
      });
      router.push(`/stock/ajustes/${result.adjustment.id}`);
    } catch (err) {
      setError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <StockSubNav />
      <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nuevo ajuste</h1>
          <p className="text-sm text-muted-foreground">
            Se guarda como borrador — no afecta el stock hasta que lo confirmes.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="warehouse">Depósito</Label>
            <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              <option value="">Elegí un depósito…</option>
              {warehousesQuery.data?.warehouses
                .filter((w) => w.status === 'ACTIVE')
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: Conteo físico, rotura, merma…"
              required
            />
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
          <Button type="submit" disabled={createAdjustment.isPending}>
            {createAdjustment.isPending ? 'Guardando…' : 'Guardar borrador'}
          </Button>
        </div>
      </form>
    </div>
  );
}
