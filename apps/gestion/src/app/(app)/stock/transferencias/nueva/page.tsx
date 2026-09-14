'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import {
  TransferLineEditor,
  toTransferLineInputs,
  type TransferLineDraft,
} from '@/components/stock/transfer-line-editor';
import { stockErrorMessage } from '@/components/stock/stock-errors';
import { usePermissions, useWarehouses, useCreateStockTransfer } from '@/lib/auth-client';

export default function NuevaTransferenciaPage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();
  const createTransfer = useCreateStockTransfer();

  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferLineDraft[]>([]);
  const [error, setError] = useState<string | undefined>();

  if (permissionsLoading) {
    return null;
  }
  if (!can('inventory.transfers.create')) {
    return <Unauthorized />;
  }

  const activeWarehouses =
    warehousesQuery.data?.warehouses.filter((w) => w.status === 'ACTIVE') ?? [];
  const sameWarehouse =
    Boolean(sourceWarehouseId) && sourceWarehouseId === destinationWarehouseId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!sourceWarehouseId || !destinationWarehouseId) {
      setError('Elegí el depósito de origen y el de destino.');
      return;
    }
    if (sameWarehouse) {
      setError('El depósito de destino debe ser distinto al de origen.');
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
      const result = await createTransfer.mutateAsync({
        sourceWarehouseId,
        destinationWarehouseId,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: toTransferLineInputs(lines),
      });
      router.push(`/stock/transferencias/${result.transfer.id}`);
    } catch (err) {
      setError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
        <PageHeader
          title="Nueva transferencia"
          description="Se guarda como borrador; el stock no se mueve hasta que la confirmes."
          backHref="/stock/transferencias"
          backLabel="Transferencias"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source">Depósito de origen</Label>
            <Select
              id="source"
              value={sourceWarehouseId}
              onChange={(e) => setSourceWarehouseId(e.target.value)}
              required
            >
              <option value="">Elegí un depósito…</option>
              {activeWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="destination">Depósito de destino</Label>
            <Select
              id="destination"
              value={destinationWarehouseId}
              onChange={(e) => setDestinationWarehouseId(e.target.value)}
              required
              aria-invalid={sameWarehouse || undefined}
            >
              <option value="">Elegí un depósito…</option>
              {/* The origin is filtered out rather than merely rejected on
                  submit: an impossible option is better never offered. */}
              {activeWarehouses
                .filter((w) => w.id !== sourceWarehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </Select>
            {sameWarehouse && (
              <p className="text-xs text-destructive">
                El depósito de destino debe ser distinto al de origen.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason">Motivo (opcional)</Label>
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Reposición de sucursal, redistribución…"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notas (opcional)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Líneas</Label>
          <p className="text-xs text-muted-foreground">
            Las existencias que se muestran son las del depósito de origen.
          </p>
          <TransferLineEditor
            sourceWarehouseId={sourceWarehouseId || null}
            lines={lines}
            onChange={setLines}
          />
        </div>

        <FieldError message={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={createTransfer.isPending}>
            {createTransfer.isPending ? 'Guardando…' : 'Guardar borrador'}
          </Button>
        </div>
      </form>
    </div>
  );
}
