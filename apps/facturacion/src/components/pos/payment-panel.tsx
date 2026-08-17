'use client';

import { useEffect, useRef, useState } from 'react';
import { Banknote, CreditCard, MoreHorizontal, Repeat } from 'lucide-react';
import { formatMoney, SALES_TENDER_METHOD_LABELS } from '@erp/shared';
import type { SalesTenderMethod, ConfirmSaleTenderInput } from '@erp/shared';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { resolveCashTender, buildTenderInput } from './pos-tender';

const METHODS: SalesTenderMethod[] = ['CASH', 'CARD', 'TRANSFER', 'OTHER'];
const METHOD_ICONS: Record<SalesTenderMethod, typeof Banknote> = {
  CASH: Banknote,
  CARD: CreditCard,
  TRANSFER: Repeat,
  OTHER: MoreHorizontal,
};

/**
 * The POS checkout step (F10) — see docs/pos.md. Doubles as the
 * confirmation step itself (no separate "are you sure" dialog): total,
 * method, and — for CASH — received/change are all visible before the
 * operator commits. `tender` sent to the backend always carries
 * `amountApplied` implicitly (the server derives it from the sale's own
 * total, never a client-supplied amount) — this panel only ever sends
 * `method`/`amountReceived`.
 *
 * `total` is a decimal string, not a `number` — every cash calculation
 * (change, insufficient-amount check) runs through `resolveCashTender`'s
 * BigInt-backed decimal-string arithmetic (`@erp/shared`), never
 * `Number()`/`parseFloat()`. See AGENTS.md's "never floating point for
 * money" rule.
 */
export function PaymentPanel({
  open,
  onOpenChange,
  total,
  currencyCode,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: string;
  currencyCode: string | null;
  onConfirm: (tender: ConfirmSaleTenderInput) => void;
  pending: boolean;
  error?: string;
}) {
  const [method, setMethod] = useState<SalesTenderMethod>('CASH');
  const [received, setReceived] = useState('');
  const receivedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      setMethod('CASH');
      setReceived('');
      receivedRef.current?.focus();
    }, 0);
    return () => clearTimeout(id);
  }, [open]);

  const { received: normalizedReceived, change, insufficient } = resolveCashTender(total, received);
  const cashInsufficient = method === 'CASH' && insufficient;
  const canConfirm = !pending && (method !== 'CASH' || !cashInsufficient);

  function submit() {
    if (!canConfirm) return;
    onConfirm(buildTenderInput(method, normalizedReceived));
  }

  const fmt = (value: string) => (currencyCode ? formatMoney(value, currencyCode) : value);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if (e.key >= '1' && e.key <= '4' && document.activeElement?.tagName !== 'INPUT') {
            const m = METHODS[Number(e.key) - 1];
            if (m) setMethod(m);
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || document.activeElement === receivedRef.current)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogTitle>Cobrar</DialogTitle>
        <div className="mt-3 flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2.5">
          <span className="text-sm font-medium text-muted-foreground">Total</span>
          <span className="text-2xl font-bold tabular-nums">{fmt(total)}</span>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-1.5" role="group" aria-label="Método de pago">
          {METHODS.map((m, i) => {
            const Icon = METHOD_ICONS[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={cn(
                  'relative flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors',
                  method === m
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                <span className="absolute top-1 left-1.5 text-[10px] text-muted-foreground/60">{i + 1}</span>
                <Icon className="size-4" aria-hidden="true" />
                {SALES_TENDER_METHOD_LABELS[m]}
              </button>
            );
          })}
        </div>

        {method === 'CASH' && (
          <div className="mt-4 flex flex-col gap-2.5 rounded-lg border border-border p-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-muted-foreground">Recibido</span>
              <Input
                ref={receivedRef}
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={total}
                className="w-36 text-right text-base font-semibold"
                aria-label="Importe recibido"
                aria-invalid={cashInsufficient}
              />
            </label>
            <div
              className={cn(
                'flex items-center justify-between rounded-md px-2 py-1.5',
                cashInsufficient ? 'bg-destructive-muted' : 'bg-success-muted',
              )}
            >
              <span className="text-sm font-medium text-muted-foreground">Vuelto</span>
              <span
                className={cn(
                  'text-lg font-bold tabular-nums',
                  cashInsufficient ? 'text-destructive' : 'text-success',
                )}
              >
                {cashInsufficient ? 'Importe insuficiente' : fmt(change)}
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-md bg-destructive-muted px-3 py-2 text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" size="lg" onClick={submit} disabled={!canConfirm}>
            {pending ? 'Confirmando…' : 'Confirmar y cobrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
