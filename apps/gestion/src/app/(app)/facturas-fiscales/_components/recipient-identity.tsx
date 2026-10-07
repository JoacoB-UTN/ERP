import { CUSTOMER_DOCUMENT_TYPE_LABELS, type FiscalSource } from '@erp/shared';

export function FiscalRecipientIdentity({ recipient }: { recipient: FiscalSource['recipient'] }) {
  const label =
    recipient.documentType === undefined
      ? 'Documento (tipo no registrado)'
      : recipient.documentType === null
        ? 'Documento (tipo sin definir)'
        : CUSTOMER_DOCUMENT_TYPE_LABELS[recipient.documentType];
  return (
    <p>
      Receptor: {recipient.legalName} · {label}: {recipient.taxId || 'Sin informar'}
    </p>
  );
}
