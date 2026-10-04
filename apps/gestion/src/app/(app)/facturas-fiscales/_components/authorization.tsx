'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FiscalCreditNotePanel } from './credit-note';
import { FiscalTestPrint } from './test-print';
import type { FiscalAuthorizationDto, FiscalDraftDto } from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  authClient,
  useActiveCompany,
  usePermissions,
  useFiscalAuthorization,
  useAuthorizeFiscalDraft,
  useReconcileFiscalAuthorization,
} from '@/lib/auth-client';

const labels = {
  SENDING: 'Envío pendiente de confirmar',
  UNKNOWN: 'Resultado desconocido',
  AUTHORIZED: 'Autorizado en pruebas',
  REJECTED: 'Rechazado en pruebas',
};
export function FiscalAuthorizationPanel({
  draft,
  canPrepare,
}: {
  draft: FiscalDraftDto;
  canPrepare: boolean;
}) {
  const { can, isLoading } = usePermissions();
  const read = !isLoading && can('sales.invoices.read');
  const allowed = read && can('sales.invoices.create');
  const query = useFiscalAuthorization(draft.id, read);
  const authorize = useAuthorizeFiscalDraft();
  const reconcile = useReconcileFiscalAuthorization();
  const { activeCompanyId } = useActiveCompany();
  const [homologation, setHomologation] = useState(false);
  const [exclusive, setExclusive] = useState(false);
  const [response, setResponse] = useState<FiscalAuthorizationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stillHere = () =>
    mounted.current && authClient.companyContextStore.getActiveCompanyId() === activeCompanyId;
  const remote = query.data?.authorization;
  const attempt = response && (!remote || response.updatedAt >= remote.updatedAt) ? response : remote;
  const known = Boolean(query.data) && !query.isError && !query.isFetching;
  const pending = attempt?.status === 'UNKNOWN' || attempt?.status === 'SENDING';
  const canSend = known && (!attempt || attempt.status === 'REJECTED');
  async function run(consult: boolean) {
    if (lock.current || !stillHere() || !allowed || !known || error) return;
    if (consult ? !pending : !canSend || !homologation || !exclusive) return;
    lock.current = true;
    setBusy(true);
    try {
      const result =
        consult && attempt
          ? await reconcile.mutateAsync(attempt.id)
          : await authorize.mutateAsync({
              draftId: draft.id,
              input: {
                expectedRevision: draft.revision,
                confirmHomologation: true,
                exclusivePointOfSale: true,
              },
            });
      if (stillHere()) {
        setResponse(result.authorization);
        setHomologation(false);
        setExclusive(false);
      }
    } catch (cause) {
      if (stillHere())
        setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el resultado.');
    } finally {
      lock.current = false;
      if (stillHere()) setBusy(false);
    }
  }
  if (!read) return null;
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Autorización en homologación</h2>
      <p>
        Solo pruebas de ARCA. Los comprobantes y CAE de este entorno no tienen validez fiscal para ventas
        reales.
      </p>
      <p className="text-sm">
        Requiere certificados configurados en el servidor, emisor habilitado y un punto de venta exclusivo
        para este ERP. Esta etapa admite productos en pesos y receptores identificados con CUIT y condición de
        IVA conocida. Los datos actuales deben coincidir con el borrador guardado.
      </p>
      {query.isPending && <p role="status">Consultando último intento…</p>}
      {query.isError && (
        <p role="alert">No se pudo consultar el último intento. Recargá antes de continuar.</p>
      )}
      {attempt && (
        <div className="space-y-2" role="status">
          <p className="font-semibold">{labels[attempt.status]}</p>
          <p>
            Punto de venta {attempt.pointOfSale} · Tipo {attempt.voucherType} · Número de prueba{' '}
            {attempt.voucherNumber}
          </p>
          <p>{attempt.message}</p>
          {attempt.cae && (
            <p>
              CAE de prueba: {attempt.cae} · Vencimiento: {attempt.expiresAt ?? 'Sin informar'}
            </p>
          )}
        </div>
      )}
      {known && attempt && <FiscalTestPrint draft={draft} authorization={attempt} canPrint={stillHere} />}
      {attempt?.status === 'AUTHORIZED' &&
        attempt.environment === 'HOMOLOGATION' &&
        attempt.draftId === draft.id &&
        attempt.draftRevision === draft.revision && (
          <FiscalCreditNotePanel key={attempt.id} originalId={attempt.id} invoice={draft} available={known} />
        )}
      {pending && (
        <p>No envíes nuevamente. Consultá el comprobante original para resolver el resultado pendiente.</p>
      )}
      {allowed && canSend && !error && (
        <fieldset disabled={busy} className="space-y-3">
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={homologation}
              onChange={(e) => setHomologation(e.target.checked)}
            />
            Confirmo que enviaré un comprobante al entorno de homologación, sin validez fiscal.
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={exclusive} onChange={(e) => setExclusive(e.target.checked)} />
            Confirmo que el punto de venta de pruebas se usa exclusivamente desde este ERP.
          </label>
          <Button disabled={busy || !homologation || !exclusive} onClick={() => void run(false)}>
            {busy ? 'Enviando…' : 'Autorizar comprobante de prueba'}
          </Button>
        </fieldset>
      )}
      {allowed && pending && (
        <Button disabled={busy || !known || Boolean(error)} onClick={() => void run(true)}>
          {busy ? 'Consultando…' : 'Consultar resultado en ARCA'}
        </Button>
      )}
      {error && (
        <p role="alert">
          {error} Recargá para verificar el estado guardado antes de continuar. No repitas el envío.
        </p>
      )}
      {(error || query.isError) && (
        <Button variant="outline" onClick={() => window.location.reload()}>
          Recargar estado
        </Button>
      )}
      {canPrepare && canSend && !busy && !error && (
        <Link className="text-primary underline" href={`/facturas-fiscales/preparar/${draft.source.saleId}`}>
          Continuar preparación
        </Link>
      )}
    </section>
  );
}
