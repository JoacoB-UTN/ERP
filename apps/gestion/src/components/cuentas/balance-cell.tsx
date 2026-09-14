import { formatMoney, type CurrencyBalance } from '@erp/shared';

import { cn } from '@/lib/utils';

/**
 * A party's balances, one line per currency.
 *
 * Never a single figure. A customer who owes 100.000 ARS and is 200 USD in
 * credit has two facts, not one, and there is no exchange rate in this system
 * to collapse them with — inventing one would produce a number nobody could
 * reconcile against either currency (see docs/current-accounts.md).
 *
 * Sign follows the ledger convention: positive means the party owes us for a
 * customer, and that we owe them for a supplier. `tone` says which reading
 * counts as "in our favour", so the colour means the same thing on both
 * screens even though the sign does not.
 */
export function BalanceCell({
  balances,
  side,
  className,
}: {
  balances: CurrencyBalance[];
  side: 'customer' | 'supplier';
  className?: string;
}) {
  if (balances.length === 0) {
    return <span className={cn('text-muted-foreground', className)}>Sin movimientos</span>;
  }

  return (
    <div className={cn('flex flex-col items-end gap-0.5', className)}>
      {balances.map((b) => {
        const value = Number(b.balance);
        // Zero is neither owed nor owing; leaving it neutral keeps the eye on
        // the rows that need action.
        const tone =
          value === 0
            ? 'text-muted-foreground'
            : side === 'customer'
              ? value > 0
                ? 'text-warning'
                : 'text-success'
              : value > 0
                ? 'text-warning'
                : 'text-success';
        return (
          <span key={b.currencyId} className={cn('tabular-nums', tone)}>
            {formatMoney(b.balance, b.currencyCode)}
          </span>
        );
      })}
    </div>
  );
}
