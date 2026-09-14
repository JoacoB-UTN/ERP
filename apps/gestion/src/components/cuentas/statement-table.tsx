'use client';

import { formatMoney } from '@erp/shared';

import { StatusBadge } from '@/components/ui/status-badge';
import { TableMessage, TableRowsSkeleton } from '@/components/ui/table-support';

export interface StatementMovement {
  id: string;
  occurredAt: string;
  movementType: string;
  description: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

/**
 * The account statement: one row per ledger movement, with the balance after
 * each.
 *
 * `runningBalance` comes from the backend and is not recomputed here. The
 * ledger is ordered by the server and each movement's balance is the sum of
 * everything up to it; recalculating in the browser would mean adding money
 * with JS numbers, and would silently disagree with the API the moment a
 * filter changed the visible window (see docs/current-accounts.md).
 *
 * Debit and credit are separate columns rather than one signed amount because
 * that is how an account statement is read in Argentina, and because it makes
 * the direction of each line obvious without decoding a sign.
 */
export function StatementTable({
  movements,
  currencyCode,
  isLoading,
  isError,
  typeLabel,
  emptyLabel,
}: {
  movements: StatementMovement[];
  currencyCode: string;
  isLoading: boolean;
  isError: boolean;
  typeLabel: (value: string) => string;
  emptyLabel: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5">Fecha</th>
            <th className="px-3 py-1.5">Concepto</th>
            <th className="px-3 py-1.5">Detalle</th>
            <th className="px-3 py-1.5 text-right">Debe</th>
            <th className="px-3 py-1.5 text-right">Haber</th>
            <th className="px-3 py-1.5 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && <TableRowsSkeleton columns={6} />}
          {!isLoading &&
            movements.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                  {formatDate(m.occurredAt)}
                </td>
                <td className="px-3 py-1 whitespace-nowrap">
                  <StatusBadge tone="neutral">{typeLabel(m.movementType)}</StatusBadge>
                </td>
                <td className="px-3 py-1">{m.description ?? '—'}</td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {Number(m.debit) !== 0 ? formatMoney(m.debit, currencyCode) : ''}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {Number(m.credit) !== 0 ? formatMoney(m.credit, currencyCode) : ''}
                </td>
                <td className="px-3 py-1 text-right font-medium tabular-nums">
                  {formatMoney(m.runningBalance, currencyCode)}
                </td>
              </tr>
            ))}
          {isError && (
            <TableMessage columns={6} kind="error" title="No pudimos cargar el movimiento de la cuenta" />
          )}
          {!isLoading && !isError && movements.length === 0 && (
            <TableMessage columns={6} title={emptyLabel} />
          )}
        </tbody>
      </table>
    </div>
  );
}
