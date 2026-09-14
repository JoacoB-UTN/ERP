'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { StockTransferDetail } from '@erp/shared';
import {
  usePermissions,
  useStockTransfer,
  useWarehouses,
  useUpdateStockTransfer,
} from '@/lib/auth-client';
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

function toDrafts(transfer: StockTransferDetail): TransferLineDraft[] {
  return transfer.lines.map((line) => ({
    key: line.id,
    variantId: line.productVariantId,
    label: line.variantName ? `${line.productName} · ${line.variantName}` : line.productName,
    sku: line.sku,
    quantity: line.quantity,
    notes: line.notes ?? '',
  }));
}

export default function EditarTransferenciaPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const transferQuery = useStockTransfer(id ?? null);
  const warehousesQuery = useWarehouses();

  if (permissionsLoading || transferQuery.isLoading || warehousesQuery.isLoading) {
    return null;
  }
  const transfer = transferQuery.data?.transfer;
  if (!can('inventory.transfers.create') || !transfer) {
    return <Unauthorized />;
  }
  if (transfer.status !== 'DRAFT') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">
          Solo se pueden editar transferencias en borrador. Una transferencia confirmada se
          corrige anulándola, que genera movimientos compensatorios.
        </p>
        <Link
          href={`/stock/transferencias/${transfer.id}`}
          className="w-fit text-sm underline-offset-4 hover:underline"
        >
          Volver a la transferencia
        </Link>
      </div>
    );
  }

  return (
    <EditarTransferenciaForm
      key={transfer.id}
      transfer={transfer}
      warehouses={warehousesQuery.data?.warehouses ?? []}
    />
  );
}

function EditarTransferenciaForm({
  transfer,
  warehouses,
}: {
  transfer: StockTransferDetail;
  warehouses: { id: string; name: string; status: string }[];
}) {
  const router = useRouter();
  const updateTransfer = useUpdateStockTransfer();

  const [sourceWarehouseId, setSourceWarehouseId] = useState(transfer.sourceWarehouseId);
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(
    transfer.destinationWarehouseId,
  );
  const [reason, setReason] = useState(transfer.reason ?? '');
  const [notes, setNotes] = useState(transfer.notes ?? '');
  const [lines, setLines] = useState<TransferLineDraft[]>(() => toDrafts(transfer));
  const [error, setError] = useState<string | undefined>();

  // The warehouses already on the transfer stay selectable even if they were
  // since deactivated: otherwise editing an unrelated field would silently
  // change where the stock goes.
  const selectable = warehouses.filter(
    (w) =>
      w.status === 'ACTIVE' ||
      w.id === transfer.sourceWarehouseId ||
      w.id === transfer.destinationWarehouseId,
  );
  const sameWarehouse = sourceWarehouseId === destinationWarehouseId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
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
      await updateTransfer.mutateAsync({
        id: transfer.id,
        input: {
          sourceWarehouseId,
          destinationWarehouseId,
          reason: reason.trim() || null,
          notes: notes.trim() || null,
          lines: toTransferLineInputs(lines),
        },
      });
      router.push(`/stock/transferencias/${transfer.id}`);
    } catch (err) {
      setError(stockErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
        <PageHeader
          title={`Editar ${transfer.number}`}
          description="Sigue siendo un borrador; el stock no se mueve hasta que la confirmes."
          backHref={`/stock/transferencias/${transfer.id}`}
          backLabel="Transferencia"
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
              {selectable.map((w) => (
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
              {selectable
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
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notas (opcional)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Líneas</Label>
          <TransferLineEditor
            sourceWarehouseId={sourceWarehouseId || null}
            lines={lines}
            onChange={setLines}
          />
        </div>

        <FieldError message={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={updateTransfer.isPending}>
            {updateTransfer.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
          <Link
            href={`/stock/transferencias/${transfer.id}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
