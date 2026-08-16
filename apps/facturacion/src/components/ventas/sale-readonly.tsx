import Link from 'next/link';
import type { SalesDocumentDetailDto } from '@erp/shared';
import { formatMoney, salesDocumentStatusLabel } from '@erp/shared';
import { SaleLinesTable, type SaleLineDraft } from './cart';
import { Button } from '@/components/ui/button';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function toDrafts(sale: SalesDocumentDetailDto): SaleLineDraft[] {
  return sale.lines.map((l) => ({
    key: l.id,
    variantId: l.productVariantId,
    label: l.description,
    sku: l.sku,
    productType: 'PRODUCT',
    quantity: l.quantity,
    discountPercentage: l.discountPercentage,
  }));
}

/** Compact, read-only — a CONFIRMED or CANCELLED sale is never editable through Facturación (see docs/sales.md's terminal-state rule). */
export function SaleReadOnly({ sale }: { sale: SalesDocumentDetailDto }) {
  const priceMap: Record<string, string | null> = Object.fromEntries(
    sale.lines.map((l) => [l.productVariantId, l.unitPrice]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{sale.number}</h1>
          <p className="text-sm text-muted-foreground">
            {sale.customer.legalName} · {sale.warehouse.name} · {sale.priceList.name}
          </p>
        </div>
        <span
          className={`text-sm font-medium ${sale.status === 'CONFIRMED' ? 'text-emerald-600' : 'text-muted-foreground'}`}
        >
          {salesDocumentStatusLabel(sale.status)}
        </span>
      </div>

      <SaleLinesTable lines={toDrafts(sale)} priceMap={priceMap} currencyCode={sale.currencyCode} readOnly onChange={() => {}} onRemove={() => {}} />

      <div className="ml-auto flex max-w-xs flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatMoney(sale.subtotal, sale.currencyCode)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Descuentos</span>
          <span className="tabular-nums">{formatMoney(sale.discountTotal, sale.currencyCode)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(sale.total, sale.currencyCode)}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {sale.status === 'CONFIRMED' && sale.confirmedAt
          ? `Confirmada el ${formatDateTime(sale.confirmedAt)}${sale.confirmedBy?.name ? ` por ${sale.confirmedBy.name}` : ''}.`
          : sale.status === 'CANCELLED' && sale.cancelledAt
            ? `Cancelada el ${formatDateTime(sale.cancelledAt)}.`
            : null}
      </p>

      <div className="flex gap-2">
        <Link href="/ventas/nueva" className="contents">
          <Button type="button">Nueva venta</Button>
        </Link>
        <Link href="/ventas" className="contents">
          <Button type="button" variant="outline">
            Ventas recientes
          </Button>
        </Link>
      </div>
    </div>
  );
}
