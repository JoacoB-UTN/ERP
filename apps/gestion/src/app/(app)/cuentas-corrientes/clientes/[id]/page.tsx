'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { customerAccountMovementLabel, formatMoney } from '@erp/shared';

import {
  usePermissions,
  useCurrencies,
  useCustomerStatement,
  useCustomerOpenSales,
} from '@/lib/auth-client';
import { StatementTable } from '@/components/cuentas/statement-table';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import { Toolbar } from '@/components/ui/toolbar';
import { Unauthorized } from '@/components/layout/unauthorized';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

export default function CuentaClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, isLoading: permissionsLoading } = usePermissions();
  const currenciesQuery = useCurrencies();
  const [currencyId, setCurrencyId] = useState('');

  // A statement has no meaning without a currency, so one is picked as soon as
  // the list arrives rather than showing an empty screen with a prompt — the
  // first, which is the company's own ordering.
  //
  // Derived at render time rather than pushed into state from an effect: the
  // project's lint rejects a synchronous setState in an effect, and rightly —
  // it is a second render pass that briefly disagrees with what is on screen.
  const currencies = currenciesQuery.data?.currencies ?? [];
  const effectiveCurrencyId = currencyId || currencies[0]?.id || '';

  const statementQuery = useCustomerStatement(id, effectiveCurrencyId || null);
  const openSalesQuery = useCustomerOpenSales(id, effectiveCurrencyId || null);

  if (permissionsLoading) {
    return null;
  }
  if (!can('accounts.receivable.read')) {
    return <Unauthorized />;
  }

  const statement = statementQuery.data;
  const openSales = openSalesQuery.data?.items ?? [];
  const currencyCode = statement?.currencyCode ?? '';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={statement?.customer.displayName ?? 'Cuenta corriente'}
        description={statement && `${statement.customer.code} · Cuenta corriente`}
        backHref="/cuentas-corrientes/clientes"
        backLabel="Cuentas corrientes"
      />

      <Toolbar>
        <Select
          value={effectiveCurrencyId}
          onChange={(e) => setCurrencyId(e.target.value)}
          className="h-8 max-w-40 py-1 text-sm"
          aria-label="Moneda"
        >
          {currencies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </Select>
      </Toolbar>

      {statement && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-sm font-semibold text-muted-foreground">Saldo inicial</div>
            <div className="mt-1 text-2xl leading-8 font-semibold tabular-nums">
              {formatMoney(statement.openingBalance, currencyCode)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-sm font-semibold text-muted-foreground">Saldo actual</div>
            <div className="mt-1 text-2xl leading-8 font-semibold tabular-nums">
              {formatMoney(statement.closingBalance, currencyCode)}
            </div>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">Movimientos</h2>
        <StatementTable
          movements={statement?.items ?? []}
          currencyCode={currencyCode}
          isLoading={statementQuery.isLoading}
          isError={statementQuery.isError}
          typeLabel={customerAccountMovementLabel}
          emptyLabel="No hay movimientos en esta moneda."
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">Ventas pendientes de cobro</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5">Número</th>
                <th className="px-3 py-1.5">Fecha</th>
                <th className="px-3 py-1.5 text-right">Total</th>
                <th className="px-3 py-1.5 text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {openSales.map((sale) => (
                <tr key={sale.id} className="border-t border-border">
                  <td className="px-3 py-1 whitespace-nowrap">
                    <Link
                      href={`/ventas/${sale.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {sale.number}
                    </Link>
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                    {formatDate(sale.occurredAt)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {formatMoney(sale.total, currencyCode)}
                  </td>
                  <td className="px-3 py-1 text-right font-medium tabular-nums">
                    {formatMoney(sale.outstanding, currencyCode)}
                  </td>
                </tr>
              ))}
              {!openSalesQuery.isLoading && openSales.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No hay ventas pendientes de cobro en esta moneda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
