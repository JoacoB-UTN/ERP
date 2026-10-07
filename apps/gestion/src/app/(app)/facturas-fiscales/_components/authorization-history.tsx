'use client';

import { useId, useState } from 'react';
import type { FiscalAuthorizationHistoryKind } from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  authClient,
  useActiveCompany,
  useFiscalAuthorizationHistory,
  usePermissions,
} from '@/lib/auth-client';

const labels = {
  SENDING: 'Envío pendiente de confirmar',
  UNKNOWN: 'Resultado desconocido',
  AUTHORIZED: 'Autorizado en pruebas',
  REJECTED: 'Rechazado en pruebas',
};
function recordedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
}

export function FiscalAuthorizationHistory({
  kind,
  id,
  available = true,
}: {
  kind: FiscalAuthorizationHistoryKind;
  id: string | null;
  available?: boolean;
}) {
  const { can, isLoading } = usePermissions();
  const { activeCompanyId } = useActiveCompany();
  if (isLoading || !can('sales.invoices.read') || !activeCompanyId || !id) return null;
  return (
    <History
      key={`${activeCompanyId}:${kind}:${id}`}
      kind={kind}
      id={id}
      companyId={activeCompanyId}
      available={available}
    />
  );
}

function History({
  kind,
  id,
  companyId,
  available,
}: {
  kind: FiscalAuthorizationHistoryKind;
  id: string;
  companyId: string;
  available: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const contentId = useId();
  const query = useFiscalAuthorizationHistory(kind, id, page, expanded && available);
  const sameCompany = () => authClient.companyContextStore.getActiveCompanyId() === companyId;
  const title = kind === 'invoice' ? 'Historial de factura' : 'Historial de nota de crédito';
  const loading = query.isPending || query.isFetching;
  const current = available && sameCompany() && !loading && !query.isError && query.data;
  const totalPages = current
    ? Math.max(1, Math.ceil(current.pagination.total / current.pagination.pageSize))
    : 1;
  const changePage = (next: number) => {
    if (!current || !sameCompany() || next < 1 || next > totalPages) return;
    setPage(next);
  };
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={title}>
      <Button
        variant="outline"
        aria-expanded={expanded}
        aria-controls={contentId}
        disabled={!available && !expanded}
        onClick={() => {
          if (sameCompany()) setExpanded((value) => !value);
        }}
      >
        {expanded ? 'Ocultar' : 'Ver'}{' '}
        {kind === 'invoice' ? 'historial de factura' : 'historial de nota de crédito'}
      </Button>
      {expanded && (
        <div id={contentId} className="space-y-3">
          <p className="text-sm">
            Intentos guardados en el ERP, sin validez fiscal. Cada fila muestra el estado actual de un
            intento; no es un registro de cada cambio de estado.
          </p>
          {!available && (
            <p role="status">Esperá a verificar el comprobante antes de consultar su historial.</p>
          )}
          {available && loading && <p role="status">Cargando historial…</p>}
          {available && query.isError && (
            <p role="alert">
              No se pudo actualizar el historial. Recargalo para ver los resultados vigentes.
            </p>
          )}
          <Button
            variant="outline"
            disabled={!available || loading}
            onClick={() => {
              if (available && !loading && sameCompany()) void query.refetch();
            }}
          >
            Recargar historial
          </Button>
          {current && (
            <>
              {current.items.length === 0 ? (
                <p role="status">Todavía no hay intentos registrados.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-left text-sm [&_th]:p-3 [&_td]:p-3 [&_tr]:border-b">
                    <caption className="sr-only">{title}</caption>
                    <thead>
                      <tr>
                        <th>Intento</th>
                        <th>Fecha de registro</th>
                        <th>Revisión</th>
                        <th>Número de prueba</th>
                        <th>Estado</th>
                        <th>Mensaje</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.items.map((attempt) => (
                        <tr key={attempt.id}>
                          <td>
                            {attempt.id === current.latestAuthorizationId ? 'Último intento' : 'Anterior'}
                          </td>
                          <td className="whitespace-nowrap">
                            <time dateTime={attempt.createdAt}>{recordedAt(attempt.createdAt)}</time>
                          </td>
                          <td>{attempt.draftRevision}</td>
                          <td className="whitespace-nowrap">
                            {String(attempt.pointOfSale).padStart(5, '0')}-
                            {String(attempt.voucherNumber).padStart(8, '0')} · Tipo {attempt.voucherType}
                          </td>
                          <td>{labels[attempt.status]}</td>
                          <td className="min-w-48 break-words">{attempt.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <nav className="flex items-center gap-3" aria-label={`Páginas del ${title.toLowerCase()}`}>
                <Button variant="outline" disabled={page <= 1} onClick={() => changePage(page - 1)}>
                  Anterior
                </Button>
                <span>
                  Página {page} de {totalPages}
                </span>
                <Button variant="outline" disabled={page >= totalPages} onClick={() => changePage(page + 1)}>
                  Siguiente
                </Button>
              </nav>
            </>
          )}
        </div>
      )}
    </section>
  );
}
