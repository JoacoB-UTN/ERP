import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { SalesDocumentDetailDto } from '@erp/shared';
import { formatMoney, salesDocumentStatusLabel, salesTenderMethodLabel } from '@erp/shared';
import { SaleLinesTable, type SaleLineDraft } from './cart';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

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
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
      <header className="flex flex-col justify-between gap-3 border-b border-border pb-4 md:flex-row md:items-end">
        <div>
          <Link
            href="/ventas"
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-3.5" />
            Ventas
          </Link>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Venta interna
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{sale.number}</h1>
            <StatusBadge status={sale.status}>{salesDocumentStatusLabel(sale.status)}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {sale.status === 'CONFIRMED'
              ? 'Venta confirmada; la operación es de solo lectura.'
              : 'Operación de solo lectura.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/ventas/nueva" className={buttonVariants()}>
            Nueva venta
          </Link>
          <Link href="/ventas" className={buttonVariants({ variant: 'outline' })}>
            Ventas recientes
          </Link>
        </div>
      </header>

      <section
        className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Resumen de la venta"
      >
        <div className="bg-card px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Cliente</p>
          <p className="mt-0.5 truncate text-sm font-medium">{sale.customer.legalName}</p>
        </div>
        <div className="bg-card px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Fecha</p>
          <p className="mt-0.5 text-sm font-medium">{formatDateTime(sale.occurredAt)}</p>
        </div>
        <div className="bg-card px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Depósito</p>
          <p className="mt-0.5 truncate text-sm font-medium">{sale.warehouse.name}</p>
        </div>
        <div className="bg-card px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Lista de precios</p>
          <p className="mt-0.5 truncate text-sm font-medium">{sale.priceList.name}</p>
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="confirmed-lines-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="confirmed-lines-heading" className="text-sm font-semibold">
            Productos
          </h2>
          <span className="text-xs text-muted-foreground">
            {sale.lines.length} {sale.lines.length === 1 ? 'línea' : 'líneas'}
          </span>
        </div>
        <SaleLinesTable
          lines={toDrafts(sale)}
          priceMap={priceMap}
          currencyCode={sale.currencyCode}
          readOnly
          onChange={() => {}}
          onRemove={() => {}}
        />
      </section>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="text-xs text-muted-foreground">
          <p>
            {sale.status === 'CONFIRMED' && sale.confirmedAt
              ? `Confirmada el ${formatDateTime(sale.confirmedAt)}${sale.confirmedBy?.name ? ` por ${sale.confirmedBy.name}` : ''}.`
              : sale.status === 'CANCELLED' && sale.cancelledAt
                ? `Cancelada el ${formatDateTime(sale.cancelledAt)}.`
                : null}
          </p>
          {sale.tender && (
            <div className="mt-3 max-w-sm rounded-md border border-border bg-card p-3 text-sm text-foreground">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pago informado
              </p>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Medio</span>
                <span className="font-medium">{salesTenderMethodLabel(sale.tender.method)}</span>
              </div>
              {sale.tender.amountReceived !== null && (
                <div className="mt-1 flex justify-between gap-4">
                  <span className="text-muted-foreground">Recibido</span>
                  <span className="tabular-nums">
                    {formatMoney(sale.tender.amountReceived, sale.currencyCode)}
                  </span>
                </div>
              )}
              {sale.tender.change !== null && (
                <div className="mt-1 flex justify-between gap-4">
                  <span className="text-muted-foreground">Vuelto</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(sale.tender.change, sale.currencyCode)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="rounded-md border border-border bg-card p-4 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatMoney(sale.subtotal, sale.currencyCode)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-4">
            <span className="text-muted-foreground">Descuentos</span>
            <span className="tabular-nums">{formatMoney(sale.discountTotal, sale.currencyCode)}</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4 border-t border-border pt-3">
            <span className="text-xs font-medium text-muted-foreground">Total {sale.currencyCode}</span>
            <span className="text-2xl font-bold tracking-tight tabular-nums">
              {formatMoney(sale.total, sale.currencyCode)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
