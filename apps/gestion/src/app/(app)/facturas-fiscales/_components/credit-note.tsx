'use client';

import { useEffect, useRef, useState } from 'react';
import { saveFiscalCreditNoteSchema, type FiscalCreditNoteDraftDto, type FiscalDraftDto } from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  authClient,
  useActiveCompany,
  usePermissions,
  useFiscalCreditNote,
  useSaveFiscalCreditNote,
} from '@/lib/auth-client';

export function FiscalCreditNotePanel({
  originalId,
  invoice,
  available = true,
}: {
  originalId: string;
  invoice: FiscalDraftDto;
  available?: boolean;
}) {
  const { can, isLoading } = usePermissions();
  const read = !isLoading && can('sales.invoices.read');
  const write = read && can('sales.invoices.create');
  const query = useFiscalCreditNote(originalId, read && available);
  if (!read) return null;
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">Borrador de nota de crédito total · Homologación · No enviado</h3>
      <p className="text-sm">
        Prepará una nota por el importe completo del comprobante original. Guardarla no envía datos a ARCA, no
        devuelve dinero ni cambia el stock o la cuenta del cliente. Sin validez fiscal.
      </p>
      {!available && (
        <p role="alert">Esperá a verificar el estado del comprobante original antes de continuar.</p>
      )}
      {query.isPending && <p role="status">Cargando nota de crédito…</p>}
      {query.isError && (
        <p role="alert">
          No se pudo actualizar la nota. Tus cambios locales se conservan; recargá antes de guardar.
        </p>
      )}
      {query.data && (
        <CreditNoteForm
          key={originalId}
          originalId={originalId}
          invoice={invoice}
          initial={query.data.draft}
          write={write}
          available={available && !query.isError && !query.isFetching}
        />
      )}
      {query.isError && !query.data && (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Reintentar carga de nota
        </Button>
      )}
    </section>
  );
}
function CreditNoteForm({
  originalId,
  invoice,
  initial,
  write,
  available,
}: {
  originalId: string;
  invoice: FiscalDraftDto;
  initial: FiscalCreditNoteDraftDto | null;
  write: boolean;
  available: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const save = useSaveFiscalCreditNote();
  const { activeCompanyId } = useActiveCompany();
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stillHere = () =>
    mounted.current && authClient.companyContextStore.getActiveCompanyId() === activeCompanyId;
  const parsed = saveFiscalCreditNoteSchema.safeParse({ reason, expectedRevision: revision });
  async function submit() {
    if (!write || !available || !parsed.success || lock.current || error || !stillHere()) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await save.mutateAsync({ originalId, input: parsed.data });
      if (stillHere()) {
        if (!result.draft) throw new Error('No se pudo confirmar el borrador guardado.');
        setSaved(result.draft);
        setRevision(result.draft.revision);
        setReason(result.draft.reason);
        setMessage('Borrador de nota de crédito guardado. No enviado a ARCA.');
      }
    } catch (cause) {
      if (stillHere()) setError(cause instanceof Error ? cause.message : 'No se pudo guardar la nota.');
    } finally {
      lock.current = false;
      if (stillHere()) setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p>Importe total de la nota: ARS {saved?.authorizedAmounts.total ?? invoice.totals.finalAmount}</p>
      {saved && (
        <p>
          Comprobante original: {saved.original.pointOfSale}-{saved.original.voucherNumber} · Tipo de nota:{' '}
          {saved.creditNoteType} · Revisión {revision}
        </p>
      )}
      {write ? (
        <fieldset disabled={busy || !available || Boolean(error)} className="space-y-3">
          <label className="flex flex-col gap-2">
            Motivo de la nota de crédito
            <textarea
              className="rounded-md border bg-background p-2"
              value={reason}
              maxLength={500}
              onChange={(e) => {
                setReason(e.target.value);
                setMessage('');
              }}
            />
          </label>
          <p className="text-sm">Describí el motivo en 5 a 500 caracteres.</p>
          <Button
            disabled={!parsed.success || busy || !available || Boolean(error)}
            onClick={() => void submit()}
          >
            {busy ? 'Guardando nota…' : 'Guardar borrador de nota'}
          </Button>
        </fieldset>
      ) : (
        <p>{saved ? `Motivo: ${saved.reason}` : 'Todavía no hay una nota de crédito preparada.'}</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert">{error} Recargá para revisar la versión vigente antes de guardar nuevamente.</p>
      )}
      {(error || !available) && (
        <Button variant="outline" onClick={() => window.location.reload()}>
          Recargar y descartar cambios de la nota
        </Button>
      )}
    </div>
  );
}
