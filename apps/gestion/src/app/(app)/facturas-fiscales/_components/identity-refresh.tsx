'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CUSTOMER_TAX_CONDITION_LABELS, refreshFiscalIdentitySchema, type FiscalDraftDto } from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  authClient,
  useActiveCompany,
  useFiscalAuthorization,
  usePermissions,
  useRefreshFiscalIdentity,
} from '@/lib/auth-client';

export function FiscalIdentityRefresh({
  draft,
  available,
  onRefreshed,
  onBusyChange,
}: {
  draft: FiscalDraftDto;
  available: boolean;
  onRefreshed: (draft: FiscalDraftDto) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { can, isLoading } = usePermissions();
  const read = !isLoading && can('sales.invoices.read');
  const write = read && can('sales.invoices.create') && can('sales.documents.read');
  const query = useFiscalAuthorization(draft.id, read);
  const refresh = useRefreshFiscalIdentity();
  const { activeCompanyId } = useActiveCompany();
  const mounted = useRef(true);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const confirmationKey = `${activeCompanyId}:${draft.id}:${draft.revision}`;
  const confirmed = confirmedKey === confirmationKey;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stillHere = () =>
    mounted.current && authClient.companyContextStore.getActiveCompanyId() === activeCompanyId;
  const known = Boolean(query.data) && !query.isPending && !query.isFetching && !query.isError;
  const noAttempt = known && query.data?.authorization === null;
  const eligible = write && available && noAttempt && !error;
  const parsed = refreshFiscalIdentitySchema.safeParse({
    expectedRevision: draft.revision,
    confirmIdentityRefresh: confirmed,
  });
  async function submit() {
    if (lock.current || !stillHere() || !eligible || !parsed.success) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const result = await refresh.mutateAsync({ draftId: draft.id, input: parsed.data });
      if (stillHere()) {
        if (
          result.draft.id !== draft.id ||
          result.draft.revision <= draft.revision ||
          result.draft.source.saleId !== draft.source.saleId
        ) {
          throw new Error('No se pudo verificar la revisión actualizada.');
        }
        setConfirmedKey(null);
        onRefreshed(result.draft);
      }
    } catch (cause) {
      if (stillHere())
        setError(cause instanceof Error ? cause.message : 'No se pudieron actualizar los datos fiscales.');
    } finally {
      lock.current = false;
      if (stillHere()) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  if (!read) return null;
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Identidad fiscal guardada">
      <h2 className="text-lg font-semibold">Datos fiscales guardados</h2>
      <p>
        Emisor: {draft.source.issuer.legalName} · CUIT: {draft.source.issuer.taxId || 'Sin informar'}
      </p>
      <p>
        Receptor: {draft.source.recipient.legalName} · CUIT: {draft.source.recipient.taxId || 'Sin informar'}
      </p>
      <p>
        Condición de IVA del receptor:{' '}
        {CUSTOMER_TAX_CONDITION_LABELS[draft.source.recipient.taxCondition] ??
          draft.source.recipient.taxCondition}
      </p>
      <p className="text-sm">
        Estos son los datos conservados en el borrador. Si corregiste la empresa o el cliente, podés traer sus
        datos actuales antes del primer envío. La clase, el IVA elegido, los renglones y los importes se
        conservan; revisalos antes de autorizar.
      </p>
      {known && query.data?.authorization && (
        <p>
          Este borrador ya tiene un intento de autorización. Sus datos fiscales no pueden actualizarse aquí.
        </p>
      )}
      {!available && <p role="status">Esperá a verificar la versión vigente del borrador.</p>}
      {query.isPending && <p role="status">Verificando si el borrador tiene envíos registrados…</p>}
      {query.isError && (
        <p role="alert">
          No se pudo verificar el historial de envíos. Recargá antes de actualizar los datos fiscales.
        </p>
      )}
      {write && noAttempt && (
        <fieldset disabled={busy || !eligible} className="space-y-3">
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmedKey(event.target.checked ? confirmationKey : null)}
            />
            Confirmo que quiero reemplazar los datos fiscales guardados por los datos actuales de la empresa y
            del cliente, conservando los importes.
          </label>
          <Button disabled={busy || !eligible || !parsed.success} onClick={() => void submit()}>
            {busy ? 'Actualizando datos fiscales…' : 'Actualizar datos fiscales del borrador'}
          </Button>
        </fieldset>
      )}
      {write && noAttempt && available && !busy && !error && (
        <Link className="text-primary underline" href={`/facturas-fiscales/preparar/${draft.source.saleId}`}>
          Revisar clase e IVA
        </Link>
      )}
      {error && <p role="alert">{error} Recargá para revisar la versión vigente antes de continuar.</p>}
      {(error || query.isError) && (
        <Button variant="outline" onClick={() => window.location.reload()}>
          Recargar datos fiscales
        </Button>
      )}
    </section>
  );
}
