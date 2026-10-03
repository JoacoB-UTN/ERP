'use client';

import { useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  createTreasuryTransferSchema,
  updateTreasuryTransferSchema,
  type TreasuryTransferDto,
  type TreasuryTransferStatus,
} from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import {
  usePermissions,
  useTreasuryAccounts,
  useTreasuryTransfers,
  useTreasuryTransfer,
  useCreateTreasuryTransfer,
  useUpdateTreasuryTransfer,
  useConfirmTreasuryTransfer,
  useCancelTreasuryTransfer,
} from '@/lib/auth-client';
import {
  ErrorNotice,
  QueryState,
  Field,
  TreasuryLink,
  Pager,
  tableClass,
  money,
  statusLabels,
  dateTime,
  dateTimeInput,
  useStillInCompany,
} from './common';

export function TransfersPage() {
  const { can, isLoading } = usePermissions();
  const [status, setStatus] = useState<TreasuryTransferStatus | ''>('');
  const [page, setPage] = useState(1);
  const query = useTreasuryTransfers(
    { status: status || undefined, page, pageSize: 25 },
    !isLoading && can('treasury.transfers.read'),
  );
  if (isLoading) return <p role="status">Cargando permisos…</p>;
  if (!can('treasury.transfers.read')) return <Unauthorized />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transferencias internas"
        description="Mové fondos entre cuentas de la misma moneda. El borrador no mueve dinero."
        actions={
          can('treasury.transfers.create') && (
            <TreasuryLink href="/tesoreria/transferencias/nueva">Nueva transferencia</TreasuryLink>
          )
        }
      />
      <Field label="Estado">
        <Select
          className="max-w-xs"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as TreasuryTransferStatus | '');
            setPage(1);
          }}
        >
          <option value="">Todos</option>
          {Object.entries(statusLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <QueryState query={query} />
      {!query.isError && query.data && (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Número / fecha</th>
                  <th>Origen → destino</th>
                  <th>Estado</th>
                  <th>Importe</th>
                </tr>
              </thead>
              <tbody>
                {query.data.transfers.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <TreasuryLink href={`/tesoreria/transferencias/${t.id}`}>{t.number}</TreasuryLink>
                      <p className="text-xs text-muted-foreground">{dateTime(t.occurredAt)}</p>
                    </td>
                    <td>
                      {t.sourceAccountName} → {t.destinationAccountName}
                    </td>
                    <td>{statusLabels[t.status]}</td>
                    <td className="font-mono">{money(t.amount, t.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!query.data.transfers.length && <p className="p-6">No hay transferencias para este filtro.</p>}
          </div>
          <Pager page={page} total={query.data.pagination.total} onPage={setPage} busy={query.isFetching} />
        </>
      )}
    </div>
  );
}

export function TransferForm({
  transfer,
  onSaved,
  onCancel,
}: {
  transfer?: TreasuryTransferDto;
  onSaved: (t: TreasuryTransferDto) => void;
  onCancel?: () => void;
}) {
  const query = useTreasuryAccounts();
  const create = useCreateTreasuryTransfer();
  const update = useUpdateTreasuryTransfer();
  const stillHere = useStillInCompany();
  const [sourceAccountId, setSource] = useState(transfer?.sourceAccountId ?? '');
  const [destinationAccountId, setDestination] = useState(transfer?.destinationAccountId ?? '');
  const [amount, setAmount] = useState(transfer?.amount ?? '');
  const [occurredAt, setOccurredAt] = useState(transfer ? dateTimeInput(transfer.occurredAt) : '');
  const [notes, setNotes] = useState(transfer?.notes ?? '');
  const [error, setError] = useState<unknown>();
  const accounts = query.data?.accounts.filter((a) => a.active) ?? [];
  const source = accounts.find((a) => a.id === sourceAccountId);
  const destinations = accounts.filter(
    (a) => a.id !== sourceAccountId && a.currencyId === source?.currencyId,
  );
  const validPair = !!source && destinations.some((a) => a.id === destinationAccountId);
  const busy = create.isPending || update.isPending;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!validPair || query.isError) {
      setError('Elegí cuentas activas distintas, de la misma moneda.');
      return;
    }
    const values = {
      sourceAccountId,
      destinationAccountId,
      amount,
      occurredAt:
        transfer && occurredAt === dateTimeInput(transfer.occurredAt)
          ? transfer.occurredAt
          : occurredAt
            ? new Date(occurredAt).toISOString()
            : undefined,
      notes,
    };
    const parsed = createTreasuryTransferSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    try {
      const result = transfer
        ? await update.mutateAsync({ id: transfer.id, input: updateTreasuryTransferSchema.parse(values) })
        : await create.mutateAsync(parsed.data);
      if (stillHere()) onSaved(result.transfer);
    } catch (err) {
      setError(err);
    }
  }
  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-lg border bg-card p-5">
      <QueryState query={query} />
      {query.data && !accounts.length && (
        <p>No hay cuentas activas. Cargá las cuentas antes de transferir.</p>
      )}
      <fieldset disabled={busy || query.isPending || query.isError} className="space-y-4">
        <Field label="Cuenta de origen">
          <Select
            required
            value={sourceAccountId}
            onChange={(e) => {
              setSource(e.target.value);
              setDestination('');
            }}
          >
            <option value="">Elegí origen</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name} ({a.currencyCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cuenta de destino">
          <Select
            required
            disabled={!source}
            value={destinationAccountId}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">Elegí destino</option>
            {destinations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name} ({a.currencyCode})
              </option>
            ))}
          </Select>
        </Field>
        {source && destinations.length === 0 && <p>No hay otra cuenta activa en {source.currencyCode}.</p>}
        {transfer && !validPair && (
          <p className="text-sm">Revisá las cuentas: alguna puede haber sido desactivada.</p>
        )}
        <Field label={`Importe${source ? ` (${source.currencyCode})` : ''}`}>
          <Input
            required
            inputMode="decimal"
            placeholder="Ej. 1500.50"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Fecha y hora (opcional)">
          <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>
        <Field label="Notas">
          <Textarea maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
      <ErrorNotice error={error} />
      <div className="flex gap-3">
        <Button type="submit" disabled={!validPair || busy || query.isError}>
          {busy ? 'Guardando…' : 'Guardar borrador'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancelar edición
          </Button>
        )}
      </div>
    </form>
  );
}

export function NewTransferPage() {
  const { can, isLoading } = usePermissions();
  const router = useRouter();
  if (isLoading) return <p role="status">Cargando permisos…</p>;
  if (!can('treasury.transfers.create')) return <Unauthorized />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva transferencia"
        backHref="/tesoreria/transferencias"
        description="Guardá un borrador y revisalo antes de confirmar el movimiento de fondos."
      />
      {can('treasury.accounts.read') ? (
        <TransferForm
          onSaved={(t) =>
            router.push(can('treasury.transfers.read') ? `/tesoreria/transferencias/${t.id}` : '/')
          }
        />
      ) : (
        <ErrorNotice error="Necesitás permiso de lectura de cuentas para seleccionar el origen y el destino." />
      )}
    </div>
  );
}
export function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading } = usePermissions();
  const query = useTreasuryTransfer(id, !isLoading && can('treasury.transfers.read'));
  if (isLoading) return <p role="status">Cargando permisos…</p>;
  if (!can('treasury.transfers.read')) return <Unauthorized />;
  return (
    <div className="space-y-6">
      <QueryState query={query} />
      {!query.isError && query.data && <TransferDetail key={id} transfer={query.data.transfer} />}
    </div>
  );
}
function TransferDetail({ transfer }: { transfer: TreasuryTransferDto }) {
  const { can } = usePermissions();
  const confirm = useConfirmTreasuryTransfer();
  const cancel = useCancelTreasuryTransfer();
  const stillHere = useStillInCompany();
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState<unknown>();
  const busy = confirm.isPending || cancel.isPending;
  async function execute() {
    if (
      !action ||
      (action === 'cancel' && transfer.status !== 'CONFIRMED') ||
      (action === 'confirm' && transfer.status !== 'DRAFT')
    )
      return;
    setError(undefined);
    try {
      await (action === 'confirm' ? confirm : cancel).mutateAsync(transfer.id);
      if (stillHere()) setAction(null);
    } catch (err) {
      if (stillHere()) setError(err);
    }
  }
  return (
    <>
      <PageHeader
        title={transfer.number}
        description={statusLabels[transfer.status]}
        backHref="/tesoreria/transferencias"
      />
      <div className="space-y-3 rounded-lg border bg-card p-5">
        <p>
          {transfer.sourceAccountName} → {transfer.destinationAccountName}
        </p>
        <p className="font-mono text-2xl">{money(transfer.amount, transfer.currencyCode)}</p>
        <p className="text-sm">{dateTime(transfer.occurredAt)}</p>
        {transfer.notes && <p>{transfer.notes}</p>}
        {transfer.confirmedAt && <p className="text-sm">Confirmada: {dateTime(transfer.confirmedAt)}</p>}
        {transfer.cancelledAt && <p className="text-sm">Anulada: {dateTime(transfer.cancelledAt)}</p>}
      </div>
      {!editing && (
        <div className="flex flex-wrap gap-3">
          {transfer.status === 'DRAFT' &&
            can('treasury.transfers.update') &&
            can('treasury.accounts.read') && (
              <Button variant="outline" disabled={busy || !!action} onClick={() => setEditing(true)}>
                Editar borrador
              </Button>
            )}
          {transfer.status === 'DRAFT' && can('treasury.transfers.confirm') && (
            <Button disabled={busy || !!action} onClick={() => setAction('confirm')}>
              Confirmar transferencia
            </Button>
          )}
          {transfer.status === 'CONFIRMED' && can('treasury.transfers.cancel') && (
            <Button variant="outline" disabled={busy || !!action} onClick={() => setAction('cancel')}>
              Anular transferencia
            </Button>
          )}
        </div>
      )}
      {editing && transfer.status === 'DRAFT' && (
        <TransferForm
          transfer={transfer}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}
      {action &&
        ((action === 'confirm' && transfer.status === 'DRAFT') ||
          (action === 'cancel' && transfer.status === 'CONFIRMED')) && (
          <section className="max-w-xl space-y-3 rounded-lg border p-5" aria-label="Revisar operación">
            <h2 className="font-semibold">
              {action === 'confirm' ? 'Confirmar movimiento de fondos' : 'Anular transferencia'}
            </h2>
            <p>
              {action === 'confirm'
                ? `Se transferirán ${money(transfer.amount, transfer.currencyCode)} de ${transfer.sourceAccountName} a ${transfer.destinationAccountName}.`
                : 'Se registrarán movimientos compensatorios. Los movimientos originales se conservarán.'}
            </p>
            <div className="flex gap-3">
              <Button disabled={busy} onClick={() => void execute()}>
                {busy ? 'Procesando…' : action === 'confirm' ? 'Sí, confirmar' : 'Sí, anular'}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setAction(null);
                  setError(undefined);
                }}
              >
                Volver
              </Button>
            </div>
          </section>
        )}
      <ErrorNotice error={error} />
    </>
  );
}
