'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  CUSTOMER_TAX_CONDITION_LABELS,
  FISCAL_TAX_TREATMENT_LABELS,
  type FiscalAuthorizationDto,
  type FiscalCreditNoteDraftDto,
  type FiscalDraftDto,
} from '@erp/shared';
import { Button } from '@/components/ui/button';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function money(value: string) {
  const [whole, fraction = '00'] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction} ARS`;
}
function date(value: string) {
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

type PrintDocument =
  { kind: 'INVOICE'; draft: FiscalDraftDto } | { kind: 'CREDIT_NOTE'; note: FiscalCreditNoteDraftDto };

export function FiscalTestPrintSheet({
  document: documentToPrint,
  authorization: a,
  canPrint,
}: {
  document: PrintDocument;
  authorization: FiscalAuthorizationDto;
  canPrint: () => boolean;
}) {
  const document = documentToPrint;
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const sheet = useRef<HTMLElement>(null);
  const printGuard = useRef(canPrint);
  const [error, setError] = useState(false);
  useEffect(() => {
    printGuard.current = canPrint;
    if (!canPrint()) sheet.current?.removeAttribute('data-fiscal-print-selected');
  }, [canPrint]);
  useEffect(() => {
    const currentSheet = sheet.current;
    const clear = () => currentSheet?.removeAttribute('data-fiscal-print-selected');
    const beforePrint = () => {
      if (!printGuard.current()) clear();
    };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', clear);
    return () => {
      clear();
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', clear);
    };
  }, [mounted, document.kind, a.id, a.draftId, a.draftRevision]);
  if (!mounted) return null;
  const invoice = document.kind === 'INVOICE' ? document.draft : document.note.invoice;
  const totals =
    document.kind === 'INVOICE'
      ? document.draft.totals
      : {
          netAmount: document.note.authorizedAmounts.net,
          vatAmount: document.note.authorizedAmounts.vat,
          exemptAmount: document.note.authorizedAmounts.exempt,
          notTaxedAmount: document.note.authorizedAmounts.notTaxed,
          finalAmount: document.note.authorizedAmounts.total,
        };
  const title =
    document.kind === 'INVOICE' ? 'Comprobante de homologación' : 'Nota de crédito total de homologación';
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          if (!canPrint() || !sheet.current) return;
          setError(false);
          window.document.querySelectorAll('[data-fiscal-print-selected]').forEach((element) => {
            element.removeAttribute('data-fiscal-print-selected');
          });
          sheet.current.setAttribute('data-fiscal-print-selected', 'true');
          try {
            // afterprint clears the selection, including non-blocking print dialogs.
            window.print();
          } catch {
            sheet.current?.removeAttribute('data-fiscal-print-selected');
            setError(true);
          }
        }}
      >
        {document.kind === 'INVOICE'
          ? 'Imprimir comprobante de prueba'
          : 'Imprimir nota de crédito de prueba'}
      </Button>
      {error && <p role="alert">No se pudo abrir la impresión. Volvé a intentarlo.</p>}
      {createPortal(
        <article ref={sheet} data-fiscal-test-print="true" aria-label={title}>
          <style>{`
        [data-fiscal-test-print] { display: none; }
        @media print {
          @page { size: A4; margin: 15mm; }
          body:has(> [data-fiscal-print-selected]) > :not([data-fiscal-print-selected]) { display: none !important; }
          html:has([data-fiscal-print-selected]), body:has(> [data-fiscal-print-selected]) { overflow: visible !important; height: auto !important; background: white !important; }
          [data-fiscal-test-print] { display: none !important; }
          [data-fiscal-test-print][data-fiscal-print-selected] { display: block !important; color: black; background: white; font: 11pt Arial, sans-serif; }
          [data-fiscal-test-print] h1 { font-size: 20pt; margin: 0 0 8mm; }
          [data-fiscal-test-print] .warning { border: 2px solid black; padding: 4mm; font-weight: bold; text-align: center; }
          [data-fiscal-test-print] table { width: 100%; border-collapse: collapse; margin-top: 5mm; }
          [data-fiscal-test-print] th, [data-fiscal-test-print] td { padding: 2mm; border-bottom: 1px solid #888; text-align: left; overflow-wrap: anywhere; }
          [data-fiscal-test-print] th:not([colspan]), [data-fiscal-test-print] td:not([colspan]):not(:first-child) { white-space: nowrap; }
          [data-fiscal-test-print] thead { display: table-header-group; }
          [data-fiscal-test-print] tfoot { display: table-footer-group; }
          [data-fiscal-test-print] tr { break-inside: avoid; }
          [data-fiscal-test-print] .totals { break-inside: avoid; margin-top: 6mm; }
          [data-fiscal-test-print] p { overflow-wrap: anywhere; margin: 2mm 0; }
        }
      `}</style>
          <h1>
            {title} · {invoice.invoiceType}
          </h1>
          <p className="warning">SIN VALIDEZ FISCAL — SOLO PRUEBAS</p>
          <p>
            Número de prueba: {String(a.pointOfSale).padStart(5, '0')}-
            {String(a.voucherNumber).padStart(8, '0')}
          </p>
          <p>
            Emisor: {invoice.source.issuer.legalName} · CUIT: {invoice.source.issuer.taxId}
          </p>
          <p>
            Receptor: {invoice.source.recipient.legalName} · CUIT: {invoice.source.recipient.taxId}
          </p>
          <p>
            Condición de IVA del receptor:{' '}
            {CUSTOMER_TAX_CONDITION_LABELS[invoice.source.recipient.taxCondition] ??
              invoice.source.recipient.taxCondition}
          </p>
          <p>Venta interna: {invoice.source.saleNumber} · Moneda: ARS</p>
          {document.kind === 'CREDIT_NOTE' && (
            <>
              <p>Motivo: {document.note.reason}</p>
              <p>
                Comprobante original de prueba: tipo {document.note.original.voucherType} ·{' '}
                {String(document.note.original.pointOfSale).padStart(5, '0')}-
                {String(document.note.original.voucherNumber).padStart(8, '0')}
              </p>
              <p>Fecha del comprobante original: {date(document.note.original.date)}</p>
              <p>Esta nota de prueba no devuelve dinero ni mercadería y no cambia la cuenta del cliente.</p>
            </>
          )}
          <table>
            <thead>
              <tr>
                <th colSpan={4}>HOMOLOGACIÓN — SIN VALIDEZ FISCAL</th>
              </tr>
              <tr>
                <th>Descripción</th>
                <th>Cantidad</th>
                <th>Tratamiento</th>
                <th>Importe final</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.salesLineId}>
                  <td>{line.description}</td>
                  <td>{line.quantity}</td>
                  <td>{FISCAL_TAX_TREATMENT_LABELS[line.treatment]}</td>
                  <td>{money(line.finalAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Documento de prueba. Sin validez fiscal.</td>
              </tr>
            </tfoot>
          </table>
          <div className="totals">
            <p>Neto: {money(totals.netAmount)}</p>
            <p>IVA: {money(totals.vatAmount)}</p>
            <p>
              Exento: {money(totals.exemptAmount)} · No gravado: {money(totals.notTaxedAmount)}
            </p>
            <p>
              <strong>Total: {money(totals.finalAmount)}</strong>
            </p>
            <p>CAE de prueba: {a.cae}</p>
            <p>Vencimiento del CAE de prueba: {date(a.expiresAt!)}</p>
            <p>
              Referencia del intento: {a.id} · Revisión del borrador: {a.draftRevision}
            </p>
            <p className="warning">SIN VALIDEZ FISCAL — SOLO PRUEBAS</p>
          </div>
        </article>,
        window.document.body,
      )}
    </>
  );
}
