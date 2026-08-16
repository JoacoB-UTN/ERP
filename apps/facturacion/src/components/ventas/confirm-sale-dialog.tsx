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
      <DialogContent>
        <DialogTitle>Confirmar venta</DialogTitle>
        <DialogDescription render={<div />} className="mt-3 flex flex-col gap-2 text-sm text-foreground">
          <span className="flex justify-between">
            <span className="text-muted-foreground">Cliente</span>
            <span className="font-medium">{customerName}</span>
          </span>
          <span className="flex justify-between text-base">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">{currencyCode ? formatMoney(String(total), currencyCode) : '—'}</span>
          </span>
          <span className="mt-1 block text-muted-foreground">
            La operación descontará stock del depósito seleccionado.
          </span>
        </DialogDescription>
        <DialogFooter>
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
