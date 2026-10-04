'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  CUSTOMER_TAX_CONDITION_LABELS,
  FISCAL_TAX_TREATMENT_LABELS,
  type FiscalAuthorizationDto,
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

export function FiscalTestPrint({
  draft,
  authorization: a,
  canPrint,
}: {
  draft: FiscalDraftDto;
  authorization: FiscalAuthorizationDto;
  canPrint: () => boolean;
}) {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const eligible =
    a.environment === 'HOMOLOGATION' &&
    a.status === 'AUTHORIZED' &&
    a.draftId === draft.id &&
    a.draftRevision === draft.revision &&
    { A: 1, B: 6, C: 11 }[draft.invoiceType] === a.voucherType &&
    /^\d{14}$/.test(a.cae ?? '') &&
    /^\d{8}$/.test(a.expiresAt ?? '');
  if (!mounted || !eligible) return null;
  const due = a.expiresAt!;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          if (canPrint()) window.print();
        }}
      >
        Imprimir comprobante de prueba
      </Button>
      {createPortal(
        <article data-fiscal-test-print="true" aria-label="Comprobante de homologación">
          <style>{`
        [data-fiscal-test-print] { display: none; }
        @media print {
          @page { size: A4; margin: 15mm; }
          body > :not([data-fiscal-test-print]) { display: none !important; }
          html, body { overflow: visible !important; height: auto !important; background: white !important; }
          [data-fiscal-test-print] { display: block !important; color: black; background: white; font: 11pt Arial, sans-serif; }
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
          <h1>Comprobante de homologación · {draft.invoiceType}</h1>
          <p className="warning">SIN VALIDEZ FISCAL — SOLO PRUEBAS</p>
          <p>
            Número de prueba: {String(a.pointOfSale).padStart(5, '0')}-
            {String(a.voucherNumber).padStart(8, '0')}
          </p>
          <p>
            Emisor: {draft.source.issuer.legalName} · CUIT: {draft.source.issuer.taxId}
          </p>
          <p>
            Receptor: {draft.source.recipient.legalName} · CUIT: {draft.source.recipient.taxId}
          </p>
          <p>
            Condición de IVA del receptor:{' '}
            {CUSTOMER_TAX_CONDITION_LABELS[draft.source.recipient.taxCondition] ??
              draft.source.recipient.taxCondition}
          </p>
          <p>Venta interna: {draft.source.saleNumber} · Moneda: ARS</p>
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
              {draft.lines.map((line) => (
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
                <td colSpan={4}>Documento de prueba. No entregar como factura fiscal.</td>
              </tr>
            </tfoot>
          </table>
          <div className="totals">
            <p>Neto: {money(draft.totals.netAmount)}</p>
            <p>IVA: {money(draft.totals.vatAmount)}</p>
            <p>
              Exento: {money(draft.totals.exemptAmount)} · No gravado: {money(draft.totals.notTaxedAmount)}
            </p>
            <p>
              <strong>Total: {money(draft.totals.finalAmount)}</strong>
            </p>
            <p>CAE de prueba: {a.cae}</p>
            <p>
              Vencimiento del CAE de prueba: {due.slice(6, 8)}/{due.slice(4, 6)}/{due.slice(0, 4)}
            </p>
            <p>
              Referencia del intento: {a.id} · Revisión del borrador: {a.draftRevision}
            </p>
            <p className="warning">SIN VALIDEZ FISCAL — SOLO PRUEBAS</p>
          </div>
        </article>,
        document.body,
      )}
    </>
  );
}
