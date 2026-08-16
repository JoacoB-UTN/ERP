import type { SalesDocumentDetailDto } from '@erp/shared';
import { formatMoney } from '@erp/shared';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A non-fiscal internal receipt — explicitly labeled as such, never
 * implies fiscal validity (no CAE/ARCA/invoice number). Hidden on screen,
 * shown only when the browser print dialog is triggered (see
 * `print:block` / `hidden` in the sale-workspace success state). See
 * docs/facturacion.md.
 */
export function PrintReceipt({ sale }: { sale: SalesDocumentDetailDto }) {
  return (
    <div className="hidden print:block">
      <h1 className="text-lg font-semibold">Comprobante interno de venta</h1>
      <p className="text-sm">
        {sale.number} · {formatDateTime(sale.occurredAt)}
      </p>
      <p className="text-sm">Cliente: {sale.customer.legalName}</p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">Producto</th>
            <th className="py-1 text-right">Cant.</th>
            <th className="py-1 text-right">Precio</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.id}>
              <td className="py-1">{line.description}</td>
              <td className="py-1 text-right">{line.quantity}</td>
              <td className="py-1 text-right">{formatMoney(line.unitPrice, sale.currencyCode)}</td>
              <td className="py-1 text-right">{formatMoney(line.totalAmount, sale.currencyCode)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-right text-base font-semibold">Total: {formatMoney(sale.total, sale.currencyCode)}</p>
      <p className="mt-6 text-xs">Documento interno. No constituye comprobante fiscal.</p>
    </div>
  );
}
