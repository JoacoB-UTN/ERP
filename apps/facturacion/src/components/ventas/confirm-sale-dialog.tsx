'use client';

import { formatMoney } from '@erp/shared';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** Short, non-alarming confirmation — states exactly what will happen (stock decreases), nothing more. See docs/facturacion.md. */
export function ConfirmSaleDialog({
  open,
  onOpenChange,
  customerName,
  total,
  currencyCode,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  total: number;
  currencyCode: string | null;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Último paso</p>
        <DialogTitle className="mt-1 text-lg">Confirmar venta</DialogTitle>
        <DialogDescription render={<div />} className="mt-4 flex flex-col gap-3 text-sm text-foreground">
          <span className="flex justify-between gap-4">
            <span className="text-muted-foreground">Cliente</span>
            <span className="text-right font-medium">{customerName}</span>
          </span>
          <span className="flex items-end justify-between gap-4 rounded-md bg-muted px-3 py-2.5">
            <span className="text-xs font-medium text-muted-foreground">Total {currencyCode ?? ''}</span>
            <span className="text-xl font-bold tracking-tight tabular-nums">
              {currencyCode ? formatMoney(String(total), currencyCode) : '—'}
            </span>
          </span>
          <span className="block border-l-2 border-warning bg-warning-muted px-3 py-2 text-xs text-foreground">
            Al confirmar, la operación queda registrada y descuenta stock del depósito seleccionado.
          </span>
        </DialogDescription>
        <DialogFooter className="mt-5">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending ? 'Confirmando…' : 'Confirmar venta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
