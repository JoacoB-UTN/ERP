'use client';

import { useEffect, useRef, useState } from 'react';
import {
  saveFiscalCreditNoteSchema,
  type FiscalAuthorizationDto,
  type FiscalCreditNoteDraftDto,
  type FiscalDraftDto,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  authClient,
  useActiveCompany,
  usePermissions,
  useFiscalCreditNote,
  useSaveFiscalCreditNote,
  useFiscalCreditNoteAuthorization,
  useAuthorizeFiscalCreditNote,
  useReconcileFiscalCreditNote,
} from '@/lib/auth-client';

const authorizationLabels = {
  SENDING: 'Envío de nota pendiente de confirmar',
  UNKNOWN: 'Resultado de la nota desconocido',
  AUTHORIZED: 'Nota autorizada en pruebas',
  REJECTED: 'Nota rechazada en pruebas',
};

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
  const { activeCompanyId } = useActiveCompany();
  const query = useFiscalCreditNote(originalId, read && available);
  if (!read) return null;
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">Nota de crédito total · Homologación · Sin validez fiscal</h3>
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
          key={`${activeCompanyId}:${originalId}`}
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
  const [operation, setOperation] = useState<'save' | 'send' | 'consult' | null>(null);
  const busy = operation !== null;
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState<FiscalAuthorizationDto | null>(null);
  const [confirmations, setConfirmations] = useState({ key: '', homologation: false, exclusive: false });
  const save = useSaveFiscalCreditNote();
  const authorizationQuery = useFiscalCreditNoteAuthorization(saved?.id ?? null, Boolean(saved));
  const authorize = useAuthorizeFiscalCreditNote();
  const reconcile = useReconcileFiscalCreditNote();
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
  const remote = authorizationQuery.data?.authorization;
  const attempt = response && (!remote || response.updatedAt >= remote.updatedAt) ? response : remote;
  const authorizationKnown =
    Boolean(authorizationQuery.data) && !authorizationQuery.isError && !authorizationQuery.isFetching;
  const mismatchedAttempt = Boolean(
    saved && attempt && (attempt.draftId !== saved.id || attempt.environment !== 'HOMOLOGATION'),
  );
  const stale = Boolean(initial && saved && (initial.id !== saved.id || initial.revision > revision));
  const pending = attempt?.status === 'SENDING' || attempt?.status === 'UNKNOWN';
  const frozen = Boolean(attempt && attempt.status !== 'REJECTED');
  const canEdit =
    write &&
    available &&
    !error &&
    !stale &&
    !mismatchedAttempt &&
    (!saved || (authorizationKnown && !frozen));
  const dirty = !saved || reason.trim() !== saved.reason;
  const canSend = Boolean(saved && canEdit && !dirty);
  const acknowledgementKey = `${saved?.id}:${revision}:${attempt?.id ?? ''}:${attempt?.updatedAt ?? ''}`;
  const homologation = confirmations.key === acknowledgementKey && confirmations.homologation;
  const exclusive = confirmations.key === acknowledgementKey && confirmations.exclusive;
  const resetConfirmations = () => setConfirmations({ key: '', homologation: false, exclusive: false });
  async function submit() {
    if (!canEdit || !parsed.success || lock.current || !stillHere()) return;
    lock.current = true;
    setOperation('save');
    setMessage('');
    try {
      const result = await save.mutateAsync({ originalId, input: parsed.data });
      if (stillHere()) {
        if (!result.draft) throw new Error('No se pudo confirmar el borrador guardado.');
        setSaved(result.draft);
        setRevision(result.draft.revision);
        setReason(result.draft.reason);
        resetConfirmations();
        setMessage('Borrador de nota de crédito guardado.');
      }
    } catch (cause) {
      if (stillHere()) setError(cause instanceof Error ? cause.message : 'No se pudo guardar la nota.');
    } finally {
      lock.current = false;
      if (stillHere()) setOperation(null);
    }
  }
  async function requestAuthorization(consult: boolean) {
    if (
      lock.current ||
      !stillHere() ||
      !write ||
      !available ||
      !saved ||
      !authorizationKnown ||
      mismatchedAttempt ||
      error
    )
      return;
    if (consult ? !pending : !canSend || !homologation || !exclusive) return;
    lock.current = true;
    setOperation(consult ? 'consult' : 'send');
    setMessage('');
    try {
      const result =
        consult && attempt
          ? await reconcile.mutateAsync(attempt.id)
          : await authorize.mutateAsync({
              creditNoteId: saved.id,
              input: { expectedRevision: revision, confirmHomologation: true, exclusivePointOfSale: true },
            });
      if (stillHere()) {
        setResponse(result.authorization);
        resetConfirmations();
      }
    } catch (cause) {
      if (stillHere())
        setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el resultado de la nota.');
    } finally {
      lock.current = false;
      if (stillHere()) setOperation(null);
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
        <fieldset disabled={busy || !canEdit} className="space-y-3">
          <label className="flex flex-col gap-2">
            Motivo de la nota de crédito
            <textarea
              className="rounded-md border bg-background p-2"
              value={reason}
              maxLength={500}
              onChange={(e) => {
                setReason(e.target.value);
                setMessage('');
                resetConfirmations();
              }}
            />
          </label>
          <p className="text-sm">Describí el motivo en 5 a 500 caracteres.</p>
          <Button disabled={!parsed.success || busy || !canEdit} onClick={() => void submit()}>
            {operation === 'save' ? 'Guardando nota…' : 'Guardar borrador de nota'}
          </Button>
        </fieldset>
      ) : (
        <p>{saved ? `Motivo: ${saved.reason}` : 'Todavía no hay una nota de crédito preparada.'}</p>
      )}
      {stale && (
        <p role="alert">
          La nota cambió en otra sesión. Recargá para revisar la versión vigente; tus cambios locales se
          conservan hasta entonces.
        </p>
      )}
      {saved && (
        <section className="space-y-3 rounded-lg border p-4">
          <h4 className="font-semibold">Autorización de la nota en homologación</h4>
          <p className="text-sm">
            El envío solicita una nota de crédito por el importe total del comprobante original. No devuelve
            dinero ni mercadería y no cambia la cuenta del cliente. La nota y su CAE de prueba no tienen
            validez fiscal.
          </p>
          {authorizationQuery.isPending && <p role="status">Consultando último intento de la nota…</p>}
          {authorizationQuery.isError && (
            <p role="alert">No se pudo verificar el último intento de la nota. Recargá antes de continuar.</p>
          )}
          {mismatchedAttempt && (
            <p role="alert">
              No se pudo verificar que el resultado corresponda a esta nota. Recargá antes de continuar.
            </p>
          )}
          {attempt && !mismatchedAttempt && (
            <div role="status" className="space-y-2">
              <p className="font-semibold">{authorizationLabels[attempt.status]}</p>
              <p>
                Punto de venta {attempt.pointOfSale} · Tipo {attempt.voucherType} · Número de nota de prueba{' '}
                {attempt.voucherNumber}
              </p>
              <p>{attempt.message}</p>
              {attempt.status === 'AUTHORIZED' && attempt.cae && (
                <p>
                  CAE de prueba de la nota: {attempt.cae} · Vencimiento: {attempt.expiresAt ?? 'Sin informar'}
                </p>
              )}
            </div>
          )}
          {pending && <p>No repitas el envío de la nota. Consultá su resultado pendiente en ARCA.</p>}
          {write && dirty && !frozen && <p>Guardá el motivo antes de autorizar la nota.</p>}
          {canSend && (
            <fieldset disabled={busy} className="space-y-3">
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={homologation}
                  onChange={(e) =>
                    setConfirmations({ key: acknowledgementKey, homologation: e.target.checked, exclusive })
                  }
                />
                Confirmo que enviaré una nota de crédito total al entorno de homologación, sin validez fiscal.
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={exclusive}
                  onChange={(e) =>
                    setConfirmations({ key: acknowledgementKey, homologation, exclusive: e.target.checked })
                  }
                />
                Confirmo que el punto de venta de pruebas se usa exclusivamente desde este ERP.
              </label>
              <Button
                disabled={busy || !homologation || !exclusive}
                onClick={() => void requestAuthorization(false)}
              >
                {operation === 'send' ? 'Enviando nota…' : 'Autorizar nota de crédito de prueba'}
              </Button>
            </fieldset>
          )}
          {write && pending && !mismatchedAttempt && (
            <Button
              disabled={busy || !available || !authorizationKnown || Boolean(error)}
              onClick={() => void requestAuthorization(true)}
            >
              {operation === 'consult' ? 'Consultando nota…' : 'Consultar resultado de la nota en ARCA'}
            </Button>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert">
          {error} Recargá para verificar el estado guardado antes de continuar. No repitas el envío.
        </p>
      )}
      {(error || !available || stale || mismatchedAttempt || (saved && authorizationQuery.isError)) && (
        <Button variant="outline" onClick={() => window.location.reload()}>
          Recargar y descartar cambios de la nota
        </Button>
      )}
    </div>
  );
}
