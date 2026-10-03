'use client';

import { useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  createTreasuryAccountSchema,
  updateTreasuryAccountSchema,
  setTreasuryOpeningBalanceSchema,
  TreasuryAccountType,
  type TreasuryAccountDto,
  type TreasuryMovementType,
} from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import {
  usePermissions,
  useActiveCompany,
  useBranches,
  useTreasuryCurrencies,
  useTreasuryAccounts,
  useTreasuryAccount,
  useTreasuryStatement,
  useCreateTreasuryAccount,
  useUpdateTreasuryAccount,
  useSetTreasuryOpeningBalance,
} from '@/lib/auth-client';
import {
  ErrorNotice,
  QueryState,
  PosNotice,
  Field,
  TreasuryLink,
  Pager,
  tableClass,
  money,
  movementLabels,
  sourceLabel,
  localDateBound,
  dateTime,
  useStillInCompany,
} from './common';

export function AccountsPage() {
  const { can, isLoading } = usePermissions();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [type, setType] = useState<TreasuryAccountType | ''>('');
  const query = useTreasuryAccounts(
    { includeInactive, type: type || undefined },
    !isLoading && can('treasury.accounts.read'),
  );
  if (isLoading) return <p role="status">Cargando permisos…</p>;
  if (!can('treasury.accounts.read')) return <Unauthorized />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cajas y bancos"
        description="Consultá cada cuenta y sus movimientos, en su propia moneda."
        actions={
          can('treasury.accounts.create') && <TreasuryLink href="/tesoreria/nueva">Nueva cuenta</TreasuryLink>
        }
      />
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Tipo de cuenta">
          <Select value={type} onChange={(e) => setType(e.target.value as TreasuryAccountType | '')}>
            <option value="">Todas</option>
            <option value="CASH_BOX">Cajas</option>
            <option value="BANK_ACCOUNT">Bancos</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Incluir inactivas
        </label>
      </div>
      <QueryState query={query} />
      {!query.isError && query.data && (
        <>
          <PosNotice />
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Tipo / sucursal</th>
                  <th>Estado</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {query.data.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <TreasuryLink href={`/tesoreria/${a.id}`}>
                        {a.code} · {a.name}
                      </TreasuryLink>
                    </td>
                    <td>
                      {a.type === 'CASH_BOX' ? 'Caja' : 'Banco'}
                      {a.branchName && ` · ${a.branchName}`}
                    </td>
                    <td>{a.active ? 'Activa' : 'Inactiva'}</td>
                    <td className="font-mono tabular-nums">{money(a.balance, a.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {query.data.accounts.length === 0 && (
              <p className="p-6 text-muted-foreground">No hay cuentas para estos filtros.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CurrencyField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const query = useTreasuryCurrencies();
  return (
    <div>
      <Field label="Moneda">
        <Select
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!query.data || query.isError}
        >
          <option value="">Elegí una moneda</option>
          {query.data?.currencies
            .filter((c) => c.active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
        </Select>
      </Field>
      <QueryState query={query} />
      {query.data?.currencies.length === 0 && <p>No hay monedas disponibles.</p>}
    </div>
  );
}

export function AccountForm({
  account,
  onSaved,
  onCancel,
}: {
  account?: TreasuryAccountDto;
  onSaved: (a: TreasuryAccountDto) => void;
  onCancel?: () => void;
}) {
  const { activeCompanyId } = useActiveCompany();
  const branches = useBranches(activeCompanyId);
  const create = useCreateTreasuryAccount();
  const update = useUpdateTreasuryAccount();
  const stillHere = useStillInCompany();
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<TreasuryAccountType>(account?.type ?? 'CASH_BOX');
  const [currencyId, setCurrencyId] = useState(account?.currencyId ?? '');
  const [branchId, setBranchId] = useState(account?.branchId ?? '');
  const [negative, setNegative] = useState(account?.allowsNegativeBalance ?? false);
  const [bank, setBank] = useState({
    bankName: account?.bankName ?? '',
    accountNumber: account?.accountNumber ?? '',
    cbu: account?.cbu ?? '',
    alias: account?.alias ?? '',
  });
  const [notes, setNotes] = useState(account?.notes ?? '');
  const [error, setError] = useState<unknown>();
  const busy = create.isPending || update.isPending;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const values = {
      name,
      branchId: branchId || (account ? null : undefined),
      allowsNegativeBalance: negative,
      ...(type === 'BANK_ACCOUNT' ? bank : {}),
      notes,
    };
    try {
      const result = account
        ? await update.mutateAsync({ id: account.id, input: updateTreasuryAccountSchema.parse(values) })
        : await create.mutateAsync(createTreasuryAccountSchema.parse({ ...values, code, type, currencyId }));
      if (stillHere()) onSaved(result.account);
    } catch (err) {
      setError(
        err instanceof Error && 'issues' in err
          ? 'Revisá los campos: código, nombre y moneda son obligatorios y los textos deben respetar su longitud máxima.'
          : err,
      );
    }
  }
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5 rounded-lg border bg-card p-5">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="Código">
          <Input
            required
            maxLength={32}
            value={code}
            disabled={!!account}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Field label="Nombre">
          <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Tipo">
          <Select
            value={type}
            disabled={!!account}
            onChange={(e) => {
              setType(e.target.value as TreasuryAccountType);
              setNegative(false);
            }}
          >
            <option value="CASH_BOX">Caja</option>
            <option value="BANK_ACCOUNT">Cuenta bancaria</option>
          </Select>
        </Field>
        {account ? (
          <Field label="Moneda">
            <Input value={account.currencyCode} disabled />
          </Field>
        ) : (
          <CurrencyField value={currencyId} onChange={setCurrencyId} />
        )}
        <div>
          <Field label="Sucursal (opcional)">
            <Select
              value={branchId}
              disabled={branches.isPending || branches.isError}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">Sin sucursal</option>
              {branches.data?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <QueryState query={branches} />
        </div>
        {type === 'BANK_ACCOUNT' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} />
              Permitir saldo negativo
            </label>
            {(['bankName', 'accountNumber', 'cbu', 'alias'] as const).map((key) => (
              <Field
                key={key}
                label={
                  { bankName: 'Banco', accountNumber: 'Número de cuenta', cbu: 'CBU', alias: 'Alias' }[key]
                }
              >
                <Input
                  value={bank[key]}
                  maxLength={key === 'bankName' ? 120 : key === 'cbu' ? 32 : 64}
                  onChange={(e) => setBank({ ...bank, [key]: e.target.value })}
                />
              </Field>
            ))}
          </>
        )}
        <Field label="Notas">
          <Textarea maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
      {account && (
        <p className="text-sm text-muted-foreground">
          El código, el tipo y la moneda se conservan para no reinterpretar el historial.
        </p>
      )}
      <ErrorNotice error={error} />
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || (!account && !currencyId)}>
          {busy ? 'Guardando…' : 'Guardar cuenta'}
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

export function NewAccountPage() {
  const { can, isLoading } = usePermissions();
  const router = useRouter();
  if (isLoading) return <p role="status">Cargando permisos…</p>;
  if (!can('treasury.accounts.create')) return <Unauthorized />;
  return (
    <div className="space-y-6">
      <PageHeader title="Nueva caja o cuenta bancaria" backHref="/tesoreria" />
      <AccountForm onSaved={(a) => router.push(can('treasury.accounts.read') ? `/tesoreria/${a.id}` : '/')} />
    </div>
  );
}

function OpeningForm({ account, onSaved }: { account: TreasuryAccountDto; onSaved: () => void }) {
  const mutation = useSetTreasuryOpeningBalance();
  const stillHere = useStillInCompany();
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const parsed = setTreasuryOpeningBalanceSchema.safeParse({
      amount,
      notes,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    try {
      await mutation.mutateAsync({ id: account.id, input: parsed.data });
      if (stillHere()) onSaved();
    } catch (err) {
      setError(err);
    }
  }
  return (
    <form onSubmit={submit} className="max-w-xl space-y-4 rounded-lg border p-5">
      <h2 className="font-semibold">Registrar saldo inicial</h2>
      <p className="text-sm text-muted-foreground">
        Solo se admite antes del primer movimiento. No reemplaza ni corrige saldos existentes.
      </p>
      <Field label={`Importe (${account.currencyCode})`}>
        <Input
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Ej. 1250.50"
        />
      </Field>
      <Field label="Fecha y hora (opcional)">
        <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </Field>
      <Field label="Notas de apertura">
        <Textarea maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <ErrorNotice error={error} />
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Registrando…' : 'Registrar saldo inicial'}
      </Button>
    </form>
  );
}

function Statement({ id }: { id: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [movementType, setMovementType] = useState<TreasuryMovementType | ''>('');
  const [page, setPage] = useState(1);
  const invalid = !!from && !!to && from > to;
  const query = useTreasuryStatement(
    id,
    {
      page,
      pageSize: 25,
      from: localDateBound(from),
      to: localDateBound(to, true),
      movementType: movementType || undefined,
    },
    !invalid,
  );
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Extracto de movimientos</h2>
      <div className="flex flex-wrap gap-3">
        <Field label="Desde">
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Hasta (inclusive)">
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Movimiento">
          <Select
            value={movementType}
            onChange={(e) => {
              setMovementType(e.target.value as TreasuryMovementType | '');
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(movementLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {invalid ? (
        <ErrorNotice error="La fecha desde debe ser anterior o igual a la fecha hasta." />
      ) : (
        <>
          <QueryState query={query} />
          {!query.isError && query.data && (
            <>
              <p className="text-sm text-muted-foreground">
                El saldo acumulado incluye los movimientos anteriores al filtro.
              </p>
              {query.data.excludesPosSales && <PosNotice />}
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Movimiento / origen</th>
                      <th>Importe</th>
                      <th>Saldo acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.rows.map((row) => (
                      <tr key={row.id}>
                        <td>{dateTime(row.occurredAt)}</td>
                        <td>
                          {movementLabels[row.movementType]}
                          <p className="text-xs text-muted-foreground break-all">
                            {row.description ?? `${sourceLabel(row.sourceType)} · ${row.sourceId}`}
                          </p>
                          {row.notes && <p className="text-xs">{row.notes}</p>}
                          {row.reversalOfId && (
                            <p className="text-xs break-all">Compensa movimiento {row.reversalOfId}</p>
                          )}
                        </td>
                        <td className="font-mono">{money(row.amount, query.data.account.currencyCode)}</td>
                        <td className="font-mono">
                          {money(row.runningBalance, query.data.account.currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {query.data.rows.length === 0 && <p className="p-6">No hay movimientos en este período.</p>}
              </div>
              <Pager
                page={page}
                total={query.data.pagination.total}
                onPage={setPage}
                busy={query.isFetching}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading } = usePermissions();
  const query = useTreasuryAccount(id, !isLoading && can('treasury.accounts.read'));
  if (isLoading) return <p role="status">Cargando permisos…</p>;
  if (!can('treasury.accounts.read')) return <Unauthorized />;
  return (
    <div className="space-y-6">
      <QueryState query={query} />
      {!query.isError && query.data && <AccountDetail key={id} account={query.data.account} />}
    </div>
  );
}
function AccountDetail({ account }: { account: TreasuryAccountDto }) {
  const { can } = usePermissions();
  const update = useUpdateTreasuryAccount();
  const stillHere = useStillInCompany();
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<unknown>();
  async function toggleActive() {
    setError(undefined);
    try {
      await update.mutateAsync({ id: account.id, input: { active: !account.active } });
    } catch (err) {
      if (stillHere()) setError(err);
    }
  }
  return (
    <>
      <PageHeader
        title={account.name}
        description={`${account.code} · ${account.type === 'CASH_BOX' ? 'Caja' : 'Cuenta bancaria'} · ${account.active ? 'Activa' : 'Inactiva'}`}
        backHref="/tesoreria"
      />
      <div className="space-y-2 rounded-lg border bg-card p-5">
        <p className="text-sm text-muted-foreground">Saldo actual · {account.currencyCode}</p>
        <p className="font-mono text-2xl">{money(account.balance, account.currencyCode)}</p>
        <PosNotice />
        {account.balance.startsWith('-') && (
          <p className="text-sm">La cuenta registra saldo negativo. Revisá sus movimientos.</p>
        )}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {[
          ['Sucursal', account.branchName],
          ['Banco', account.bankName],
          ['Número de cuenta', account.accountNumber],
          ['CBU', account.cbu],
          ['Alias', account.alias],
          ['Notas', account.notes],
        ].map(([label, value]) =>
          value ? (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ) : null,
        )}
        <div>
          <dt className="text-muted-foreground">Descubierto</dt>
          <dd>{account.allowsNegativeBalance ? 'Permitido' : 'No permitido'}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        {can('treasury.accounts.update') && (
          <>
            <Button variant="outline" onClick={() => setEditing(!editing)} disabled={update.isPending}>
              {editing ? 'Cerrar edición' : 'Editar cuenta'}
            </Button>
            <Button variant="outline" onClick={() => void toggleActive()} disabled={update.isPending}>
              {account.active ? 'Desactivar cuenta' : 'Activar cuenta'}
            </Button>
          </>
        )}
        {can('treasury.movements.create') && account.active && (
          <Button variant="outline" onClick={() => setOpening(!opening)}>
            {opening ? 'Cerrar apertura' : 'Cargar saldo inicial'}
          </Button>
        )}
      </div>
      <ErrorNotice error={error} />
      {editing && (
        <AccountForm account={account} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
      )}
      {opening && account.active && <OpeningForm account={account} onSaved={() => setOpening(false)} />}
      {can('treasury.movements.read') ? (
        <Statement id={account.id} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Necesitás permiso de lectura de movimientos para ver el extracto.
        </p>
      )}
    </>
  );
}
