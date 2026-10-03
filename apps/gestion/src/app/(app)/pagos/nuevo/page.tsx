'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@erp/auth-client';
import {
  SALES_TENDER_METHOD_LABELS,
  createSupplierPaymentSchema,
  formatMoney,
  subtractDecimalStrings,
  sumDecimalStrings,
} from '@erp/shared';

import {
  usePermissions,
  useCurrencies,
  useSupplierLookup,
  useSupplierOpenReceipts,
  useCreateSupplierPayment,
  useTreasuryAccountOptions,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Unauthorized } from '@/components/layout/unauthorized';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

export default function NuevoPagoPage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const currenciesQuery = useCurrencies();
  const createPayment = useCreateSupplierPayment();
  const treasuryAccountsQuery = useTreasuryAccountOptions();

  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [notes, setNotes] = useState('');
  /** purchaseReceiptId -> amount to apply, as typed. */
  const [applications, setApplications] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useSupplierLookup({ search: supplierSearch || undefined, limit: 20 });

  // Derived, not synced from an effect: a synchronous setState inside an
  // effect is a second render pass that briefly disagrees with the screen,
  // and the project's lint rejects it.
  const currencies = currenciesQuery.data?.currencies ?? [];
  const effectiveCurrencyId = currencyId || currencies[0]?.id || '';
  const treasuryAccounts = treasuryAccountsQuery.data?.accounts ?? [];
  // The API rejects an account whose currency is not the document's — see
  // docs/treasury.md. Offering one here only builds a form that fails on
  // submit, so the list is filtered rather than merely labelled with the
  // currency and left for the operator to police.
  const eligibleAccounts = treasuryAccounts.filter((account) => account.currencyId === effectiveCurrencyId);

  const openReceiptsQuery = useSupplierOpenReceipts(supplierId || null, effectiveCurrencyId || null);

  // Applications point at specific documents, in one currency, for one party.
  // Changing either would leave rows that no longer belong here, so both
  // setters clear them — handled in the event that caused it rather than in
  // an effect reacting to it afterwards.
  function changeParty(value: string) {
    setSupplierId(value);
    setApplications({});
  }

  function changeCurrency(value: string) {
    setCurrencyId(value);
    setApplications({});
    // The account already chosen may not hold the new currency, and a
    // selection the list no longer offers is worse than none: the field
    // looks filled and the submit fails. Cleared in the event that caused
    // it, not in an effect reacting to it afterwards — same rule as the
    // applications above.
    setTreasuryAccountId((current) => {
      const chosen = treasuryAccounts.find((account) => account.id === current);
      return chosen && chosen.currencyId === value ? current : '';
    });
  }

  const openReceipts = openReceiptsQuery.data?.items ?? [];
  const currencyCode =
    openReceiptsQuery.data?.currencyCode ??
    currencies.find((c) => c.id === effectiveCurrencyId)?.code ??
    '';

  const appliedTotal = useMemo(() => {
    const values = Object.values(applications).filter((v) => v.trim() !== '');
    // Summed as decimal strings, never with JS `+`: this figure is compared
    // against the collection amount and shown to the user as money.
    return values.length > 0 ? sumDecimalStrings(values) : '0';
  }, [applications]);

  const unapplied = amount.trim() ? subtractDecimalStrings(amount.trim(), appliedTotal) : null;

  if (permissionsLoading) {
    return null;
  }
  if (!can('treasury.payments.create')) {
    return <Unauthorized />;
  }

  function setApplication(purchaseReceiptId: string, value: string) {
    setApplications((prev) => ({ ...prev, [purchaseReceiptId]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createSupplierPaymentSchema.safeParse({
      supplierId,
      currencyId: effectiveCurrencyId,
      amount: amount.trim(),
      paymentMethod,
      treasuryAccountId,
      externalReference: externalReference.trim() || undefined,
      notes: notes.trim() || undefined,
      applications: Object.entries(applications)
        .filter(([, v]) => v.trim() !== '' && Number(v) > 0)
        .map(([purchaseReceiptId, v]) => ({ purchaseReceiptId, amount: v.trim() })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisá los datos ingresados.');
      return;
    }

    try {
      const result = await createPayment.mutateAsync(parsed.data);
      // Created as a DRAFT — the ledger only moves on confirm, which happens
      // from the detail screen, deliberately as a separate decision.
      router.push(`/pagos/${result.payment.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el pago.');
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Nuevo pago"
        description="Se crea como borrador. La cuenta corriente se mueve recién al confirmarlo."
        backHref="/pagos"
        backLabel="Pagos"
      />

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="supplier-search">Buscar proveedor</Label>
            <Input
              id="supplier-search"
              value={supplierSearch}
              onChange={(e) => setSupplierSearch(e.target.value)}
              placeholder="Nombre, código o CUIT…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="supplierId">Proveedor</Label>
            <Select
              id="supplierId"
              value={supplierId}
              onChange={(e) => changeParty(e.target.value)}
              required
            >
              <option value="">Elegí un proveedor</option>
              {suppliersQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.displayName}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currencyId">Moneda</Label>
            <Select
              id="currencyId"
              value={effectiveCurrencyId}
              onChange={(e) => changeCurrency(e.target.value)}
              required
            >
              {currencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amount">Importe</Label>
            <Input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="paymentMethod">Medio de pago</Label>
            <Select
              id="paymentMethod"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              {Object.entries(SALES_TENDER_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            {/*
              Required: the payment method says HOW, this says WHERE the
              money sale — see docs/treasury.md. Without it the document
              would move a balance nobody can point at.
            */}
            <Label htmlFor="treasuryAccountId">Cuenta de tesorería</Label>
            <Select
              id="treasuryAccountId"
              value={treasuryAccountId}
              onChange={(e) => setTreasuryAccountId(e.target.value)}
              required
            >
              <option value="">Elegí una caja o cuenta bancaria…</option>
              {eligibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currencyCode})
                </option>
              ))}
            </Select>
            {treasuryAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay cajas ni cuentas bancarias cargadas todavía.
              </p>
            ) : eligibleAccounts.length === 0 ? (
              // Distinct from the empty case on purpose: "there are none"
              // and "none of yours holds this currency" send the operator
              // to two different places.
              <p className="text-sm text-muted-foreground">
                Ninguna caja ni cuenta bancaria está en {currencyCode || 'esta moneda'}. Creá una en esa
                moneda para poder pagar.
              </p>
            ) : null}
          </div>
        </div>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Aplicar a recepciones</h2>
            {unapplied !== null && (
              <p className="text-sm text-muted-foreground">
                Aplicado {formatMoney(appliedTotal, currencyCode)} ·{' '}
                <span className={Number(unapplied) < 0 ? 'text-destructive' : ''}>
                  Sin aplicar {formatMoney(unapplied, currencyCode)}
                </span>
              </p>
            )}
          </div>
          {/* Applying is optional on purpose: money can go out before there
              is a receipt to put it against, and the remainder stays as a
              credit with the supplier (see docs/current-accounts.md). */}
          <p className="text-xs text-muted-foreground">
            Opcional. Lo que no apliques queda como saldo a favor nuestro con el proveedor.
          </p>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5">Recepción</th>
                  <th className="px-3 py-1.5">Fecha</th>
                  <th className="px-3 py-1.5 text-right">Total</th>
                  <th className="px-3 py-1.5 text-right">Pendiente</th>
                  <th className="px-3 py-1.5 text-right">A aplicar</th>
                </tr>
              </thead>
              <tbody>
                {openReceipts.map((receipt) => (
                  <tr key={receipt.id} className="border-t border-border">
                    <td className="px-3 py-1 whitespace-nowrap font-medium">{receipt.number}</td>
                    <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                      {formatDate(receipt.receiptDate)}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      {formatMoney(receipt.total, currencyCode)}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      {formatMoney(receipt.outstanding, currencyCode)}
                    </td>
                    <td className="px-3 py-1 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Input
                          inputMode="decimal"
                          value={applications[receipt.id] ?? ''}
                          onChange={(e) => setApplication(receipt.id, e.target.value)}
                          className="h-8 max-w-32 py-1 text-right text-sm"
                          aria-label={`Importe a aplicar a ${receipt.number}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setApplication(receipt.id, receipt.outstanding)}
                        >
                          Todo
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!supplierId && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Elegí un proveedor para ver sus recepciones pendientes.
                    </td>
                  </tr>
                )}
                {supplierId && !openReceiptsQuery.isLoading && openReceipts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Este proveedor no tiene recepciones pendientes en esta moneda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="externalReference">Referencia</Label>
            <Input
              id="externalReference"
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
              placeholder="Nº de transferencia, cheque…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notas</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={createPayment.isPending}>
            {createPayment.isPending ? 'Creando…' : 'Crear borrador'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push('/pagos')}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
