'use client';

import { useEffect, useRef, useState } from 'react';
import { formatMoney, SALES_TENDER_METHOD_LABELS } from '@erp/shared';
import type { SalesTenderMethod, ConfirmSaleTenderInput } from '@erp/shared';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { resolveCashTender, buildTenderInput } from './pos-tender';

const METHODS: SalesTenderMethod[] = ['CASH', 'CARD', 'TRANSFER', 'OTHER'];

/**
 * The POS checkout step (F10) — see docs/pos.md. Doubles as the
 * confirmation step itself (no separate "are you sure" dialog): total,
 * method, and — for CASH — received/change are all visible before the
 * operator commits. `tender` sent to the backend always carries
 * `amountApplied` implicitly (the server derives it from the sale's own
 * total, never a client-supplied amount) — this panel only ever sends
 * `method`/`amountReceived`.
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
  total: number;
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

  const { receivedNum, change, insufficient } = resolveCashTender(total, received);
  const cashInsufficient = method === 'CASH' && insufficient;
  const canConfirm = !pending && (method !== 'CASH' || !cashInsufficient);

  function submit() {
    if (!canConfirm) return;
    onConfirm(buildTenderInput(method, receivedNum));
  }

  const fmt = (n: number) => (currencyCode ? formatMoney(String(n), currencyCode) : String(n));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
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
        <div className="mt-3 flex justify-between text-base">
          <span className="text-muted-foreground">Total</span>
          <span className="text-xl font-semibold tabular-nums">{fmt(total)}</span>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-1.5" role="group" aria-label="Método de pago">
          {METHODS.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                method === m
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <span className="text-[10px] text-muted-foreground/70">{i + 1}</span>
              {SALES_TENDER_METHOD_LABELS[m]}
            </button>
          ))}
        </div>

        {method === 'CASH' && (
          <div className="mt-4 flex flex-col gap-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Recibido</span>
              <Input
                ref={receivedRef}
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={String(total)}
                className="w-32 text-right"
                aria-label="Importe recibido"
                aria-invalid={cashInsufficient}
              />
            </label>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Vuelto</span>
              <span className={cn('font-medium tabular-nums', cashInsufficient && 'text-destructive')}>
                {cashInsufficient ? 'Importe insuficiente' : fmt(Math.max(change, 0))}
              </span>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={!canConfirm}>
            {pending ? 'Confirmando…' : 'Confirmar y cobrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
