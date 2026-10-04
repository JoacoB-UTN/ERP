'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  FISCAL_TAX_TREATMENT_LABELS,
  type FiscalDraftDto,
  type FiscalDraftFilter,
  type FiscalDraftListItem,
  type FiscalDraftInput,
  type FiscalInvoiceType,
  type FiscalPreview,
  type FiscalSource,
  type FiscalTaxTreatment,
} from '@erp/shared';
import { FiscalAuthorizationPanel } from './authorization';
import { FiscalIdentityRefresh } from './identity-refresh';
import { Button } from '@/components/ui/button';
import {
  authClient,
  useActiveCompany,
  usePermissions,
  useFiscalSales,
  useFiscalDrafts,
  useFiscalSource,
  useFiscalDraftForSale,
  useFiscalDraft,
  usePreviewFiscalDraft,
  useSaveFiscalDraft,
} from '@/lib/auth-client';

const linkClass = 'font-medium text-primary underline underline-offset-4';
const tableClass = 'w-full text-left text-sm [&_th]:p-3 [&_td]:p-3 [&_tr]:border-b';
const selectClass = 'rounded-md border bg-background p-2 text-sm';
function money(amount: string) {
  const [whole, fraction] = amount.split('.');
  return `ARS ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction ? `,${fraction}` : ''}`;
}
function Notice() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <strong>Borrador · Sin validez fiscal</strong>
      <p>
        Prepará el desglose sin cambiar la venta, el stock ni la deuda. La empresa emisora, su condición
        fiscal y la conexión con ARCA todavía requieren configuración y verificación.
      </p>
    </div>
  );
}
function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
function QueryState({
  query,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
}) {
  if (query.isPending) return <p role="status">Cargando…</p>;
  if (query.isError)
    return (
      <div>
        <ErrorNotice error={query.error} />
        <Button variant="outline" onClick={() => void query.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  return null;
}
function Pager({
  page,
  totalPages,
  setPage,
}: {
  page: number;
  totalPages: number;
  setPage: (p: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        Anterior
      </Button>
      <span>Página {page}</span>
      <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
        Siguiente
      </Button>
    </div>
  );
}
function useAccess() {
  const { can, isLoading } = usePermissions();
  return {
    loading: isLoading,
    read: !isLoading && can('sales.invoices.read'),
    prepare:
      !isLoading && can('sales.invoices.read') && can('sales.invoices.create') && can('sales.documents.read'),
  };
}
function authorizationLabel(authorization: FiscalDraftListItem['authorization'] | undefined) {
  if (authorization === null) return 'Sin enviar';
  if (!authorization) return 'Datos no disponibles';
  return (
    {
      SENDING: 'Envío pendiente de confirmar',
      UNKNOWN: 'Resultado desconocido',
      AUTHORIZED: 'Autorizado en pruebas',
      REJECTED: 'Rechazado en pruebas',
    }[authorization.status] ?? 'Datos no disponibles'
  );
}
function CreditNoteSummary({
  note,
  draftId,
}: {
  note: FiscalDraftListItem['creditNote'] | undefined;
  draftId: string;
}) {
  if (note === null) return <>Sin nota</>;
  if (!note) return <>Datos no disponibles</>;
  const authorization = note.authorization;
  const label =
    authorization === null
      ? 'Nota preparada'
      : authorization
        ? ({
            SENDING: 'Envío de NC pendiente',
            UNKNOWN: 'Resultado de NC desconocido',
            AUTHORIZED: 'NC autorizada en pruebas',
            REJECTED: 'NC rechazada en pruebas',
          }[authorization.status] ?? 'Datos no disponibles')
        : 'Datos no disponibles';
  const pending = authorization?.status === 'SENDING' || authorization?.status === 'UNKNOWN';
  return (
    <div className="space-y-1">
      <p>{label}</p>
      {authorization && (
        <p className="whitespace-nowrap">
          NC {String(authorization.pointOfSale).padStart(5, '0')}-
          {String(authorization.voucherNumber).padStart(8, '0')} · Tipo {authorization.voucherType}
        </p>
      )}
      <Link className={linkClass} href={`/facturas-fiscales/${draftId}#nota-de-credito`}>
        {pending ? 'Consultar resultado de NC' : 'Ver nota de crédito'}
      </Link>
    </div>
  );
}
export function FiscalListPage() {
  const access = useAccess();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FiscalDraftFilter>('ALL');
  const query = useFiscalDrafts(page, access.read, filter);
  if (access.loading) return <p>Cargando permisos…</p>;
  if (!access.read) return <p>No tenés permiso para consultar borradores fiscales.</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Comprobantes de prueba</h1>
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Homologación de ARCA · Sin validez fiscal</strong>
        <p>
          Revisá los borradores y el último resultado de cada envío de prueba. Los comprobantes autorizados en
          este entorno no tienen validez para ventas reales.
        </p>
      </div>
      {access.prepare && (
        <Link className={linkClass} href="/facturas-fiscales/nueva">
          Preparar desde una venta
        </Link>
      )}
      <label className="flex max-w-sm flex-col gap-2">
        Mostrar comprobantes
        <select
          className={selectClass}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as FiscalDraftFilter);
            setPage(1);
          }}
        >
          <option value="ALL">Todos</option>
          <option value="PENDING">Todos por consultar</option>
          <option value="INVOICE_PENDING">Facturas por consultar</option>
          <option value="CREDIT_NOTE_PENDING">Notas por consultar</option>
        </select>
      </label>
      {filter !== 'ALL' && (
        <p className="text-sm">
          Envíos pendientes de confirmar o con resultado desconocido. Abrí el detalle para consultar su
          resultado.
        </p>
      )}
      <QueryState query={query} />
      {!query.isError && query.data && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Venta de origen</th>
                  <th>Cliente</th>
                  <th>Clase propuesta</th>
                  <th>Total</th>
                  <th>Revisión</th>
                  <th>Estado del último intento</th>
                  <th>Número de prueba</th>
                  <th>Nota de crédito</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((draft) => (
                  <tr key={draft.id}>
                    <td>{draft.source.saleNumber}</td>
                    <td>{draft.source.recipient.legalName}</td>
                    <td>{draft.invoiceType}</td>
                    <td>{money(draft.totals.finalAmount)}</td>
                    <td>{draft.revision}</td>
                    <td>{authorizationLabel(draft.authorization)}</td>
                    <td>
                      {draft.authorization
                        ? `${String(draft.authorization.pointOfSale).padStart(5, '0')}-${String(draft.authorization.voucherNumber).padStart(8, '0')}`
                        : '—'}
                    </td>
                    <td>
                      <CreditNoteSummary note={draft.creditNote} draftId={draft.id} />
                    </td>
                    <td>
                      <Link className={linkClass} href={`/facturas-fiscales/${draft.id}`}>
                        {draft.authorization?.status === 'UNKNOWN' ||
                        draft.authorization?.status === 'SENDING'
                          ? 'Consultar resultado'
                          : 'Ver detalle'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data.items.length === 0 && (
            <p role="status">
              {
                {
                  ALL: 'Todavía no hay borradores fiscales.',
                  PENDING: 'No hay facturas ni notas de crédito por consultar.',
                  INVOICE_PENDING: 'No hay facturas por consultar.',
                  CREDIT_NOTE_PENDING: 'No hay notas de crédito por consultar.',
                }[filter]
              }
            </p>
          )}
          <Pager page={page} totalPages={query.data.pagination.totalPages} setPage={setPage} />
        </>
      )}
    </div>
  );
}
export function FiscalNewPage() {
  const access = useAccess();
  const [page, setPage] = useState(1);
  const query = useFiscalSales(page, access.prepare);
  if (access.loading) return <p>Cargando permisos…</p>;
  if (!access.prepare) return <p>No tenés permiso para preparar borradores fiscales desde ventas.</p>;
  return (
    <div className="space-y-6">
      <Link className={linkClass} href="/facturas-fiscales">
        Volver a borradores
      </Link>
      <h1 className="text-2xl font-semibold">Elegí una venta confirmada</h1>
      <Notice />
      <p>
        Primera etapa: ventas en pesos argentinos. Si ya existe un borrador para la venta, se abrirá para
        continuar.
      </p>
      <QueryState query={query} />
      {!query.isError && query.data && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Venta</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.number}</td>
                    <td>{sale.customer.legalName}</td>
                    <td>
                      {sale.currencyCode === 'ARS' ? money(sale.total) : `${sale.currencyCode} ${sale.total}`}
                    </td>
                    <td>
                      {sale.currencyCode === 'ARS' ? (
                        <Link className={linkClass} href={`/facturas-fiscales/preparar/${sale.id}`}>
                          Preparar
                        </Link>
                      ) : (
                        'Moneda no disponible en esta etapa'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data.items.length === 0 && <p>No hay ventas confirmadas para mostrar.</p>}
          <Pager
            page={page}
            totalPages={Math.ceil(query.data.pagination.total / query.data.pagination.pageSize)}
            setPage={setPage}
          />
        </>
      )}
    </div>
  );
}
export function Breakdown({ preview }: { preview: FiscalPreview }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Desglose propuesto · Clase {preview.invoiceType}</h2>
      <p>La clase elegida no acredita que corresponda a este emisor y receptor.</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className={tableClass}>
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Tratamiento</th>
              <th>Neto</th>
              <th>IVA</th>
              <th>Exento</th>
              <th>No gravado</th>
              <th>Final</th>
            </tr>
          </thead>
          <tbody>
            {preview.lines.map((line) => (
              <tr key={line.salesLineId}>
                <td>{line.description}</td>
                <td>{FISCAL_TAX_TREATMENT_LABELS[line.treatment]}</td>
                <td>{money(line.netAmount)}</td>
                <td>{money(line.vatAmount)}</td>
                <td>{money(line.exemptAmount)}</td>
                <td>{money(line.notTaxedAmount)}</td>
                <td>{money(line.finalAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>Totales</th>
              <td>{money(preview.totals.netAmount)}</td>
              <td>{money(preview.totals.vatAmount)}</td>
              <td>{money(preview.totals.exemptAmount)}</td>
              <td>{money(preview.totals.notTaxedAmount)}</td>
              <td>{money(preview.totals.finalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <h3 className="font-medium">Pendiente antes de emitir</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {preview.pendingRequirements.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
export function FiscalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const access = useAccess();
  const query = useFiscalDraft(id, access.read);
  const { activeCompanyId } = useActiveCompany();
  if (access.loading) return <p>Cargando permisos…</p>;
  if (!access.read) return <p>No tenés permiso para consultar borradores fiscales.</p>;
  return (
    <div className="space-y-6">
      <Link className={linkClass} href="/facturas-fiscales">
        Volver a borradores
      </Link>
      <h1 className="text-2xl font-semibold">Borrador fiscal</h1>
      <Notice />
      <QueryState query={query} />
      {query.data && (
        <FiscalDetail
          key={`${activeCompanyId}:${id}`}
          remote={query.data.draft}
          available={!query.isError && !query.isFetching && !query.isPending}
          canPrepare={access.prepare}
        />
      )}
    </div>
  );
}
function FiscalDetail({
  remote,
  available,
  canPrepare,
}: {
  remote: FiscalDraftDto;
  available: boolean;
  canPrepare: boolean;
}) {
  const [refreshed, setRefreshed] = useState<FiscalDraftDto | null>(null);
  const [refreshingRevision, setRefreshingRevision] = useState<number | null>(null);
  const draft =
    refreshed && refreshed.id === remote.id && refreshed.revision > remote.revision ? refreshed : remote;
  const busy = refreshingRevision === draft.revision;
  return (
    <>
      <p>
        Venta {draft.source.saleNumber} · {draft.source.recipient.legalName} · Revisión {draft.revision}
      </p>
      <FiscalIdentityRefresh
        key={`identity:${draft.id}:${draft.revision}`}
        draft={draft}
        available={available}
        onBusyChange={(value) => setRefreshingRevision(value ? draft.revision : null)}
        onRefreshed={(result) => {
          setRefreshed(result);
          setRefreshingRevision(null);
        }}
      />
      {refreshed && (
        <p role="status">Datos fiscales actualizados. Revisá la clase y el IVA antes de autorizar.</p>
      )}
      <FiscalAuthorizationPanel
        key={`authorization:${draft.id}:${draft.revision}`}
        draft={draft}
        canPrepare={canPrepare}
        available={available && !busy}
      />
      <Breakdown preview={draft} />
    </>
  );
}
export function FiscalPreparePage() {
  const { saleId } = useParams<{ saleId: string }>();
  const access = useAccess();
  const source = useFiscalSource(saleId, access.prepare);
  const draft = useFiscalDraftForSale(saleId, access.prepare);
  if (access.loading) return <p>Cargando permisos…</p>;
  if (!access.prepare) return <p>No tenés permiso para preparar borradores fiscales desde ventas.</p>;
  return (
    <div className="space-y-6">
      <Link className={linkClass} href="/facturas-fiscales">
        Volver a borradores
      </Link>
      <h1 className="text-2xl font-semibold">Preparar borrador fiscal</h1>
      <Notice />
      <QueryState query={source} />
      <QueryState query={draft} />
      {/* Keep the initialized form mounted when a background refetch fails. */}
      {source.data && draft.data && (
        <FiscalForm
          key={saleId}
          source={draft.data.draft?.source ?? source.data.source}
          draft={draft.data.draft}
        />
      )}
    </div>
  );
}
export function FiscalForm({
  source: initialSource,
  draft,
}: {
  source: FiscalSource;
  draft: FiscalDraftDto | null;
}) {
  // Capture the loaded revision and source once; background refetches must not overwrite edits.
  const [source] = useState(initialSource);
  const [invoiceType, setInvoiceType] = useState<FiscalInvoiceType | ''>(draft?.invoiceType ?? '');
  const [treatments, setTreatments] = useState<Record<string, FiscalTaxTreatment>>(() =>
    Object.fromEntries(draft?.lines.map((line) => [line.salesLineId, line.treatment]) ?? []),
  );
  const [confirmed, setConfirmed] = useState(Boolean(draft));
  const [revision, setRevision] = useState(draft?.revision ?? 0);
  const [preview, setPreview] = useState<FiscalPreview | null>(draft);
  const [saved, setSaved] = useState<FiscalDraftDto | null>(draft);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const previewMutation = usePreviewFiscalDraft();
  const saveMutation = useSaveFiscalDraft();
  const { activeCompanyId } = useActiveCompany();
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stillHere = () =>
    mounted.current && authClient.companyContextStore.getActiveCompanyId() === activeCompanyId;
  const changed = () => {
    setPreview(null);
    setSaved(null);
    setError(null);
  };
  const complete =
    invoiceType !== '' && confirmed && source.lines.every((line) => Boolean(treatments[line.salesLineId]));
  const input = (): FiscalDraftInput => ({
    invoiceType: invoiceType as FiscalInvoiceType,
    amountInterpretation: 'FINAL_AMOUNTS_INCLUDE_VAT',
    lines: source.lines.map((line) => ({
      salesLineId: line.salesLineId,
      treatment: treatments[line.salesLineId],
    })),
  });
  async function run(save: boolean) {
    if (!complete || inFlight.current || !stillHere() || (save && !preview)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (save) {
        const result = await saveMutation.mutateAsync({
          saleId: source.saleId,
          input: { ...input(), expectedRevision: revision },
        });
        if (stillHere()) {
          setRevision(result.draft.revision);
          setSaved(result.draft);
          setPreview(result.draft);
        }
      } else {
        const result = await previewMutation.mutateAsync({ saleId: source.saleId, input: input() });
        if (stillHere()) setPreview(result.preview);
      }
    } catch (cause) {
      if (stillHere()) {
        setError(cause);
        if (save) setPreview(null);
      }
    } finally {
      inFlight.current = false;
      if (stillHere()) setBusy(false);
    }
  }
  const choices = (Object.keys(FISCAL_TAX_TREATMENT_LABELS) as FiscalTaxTreatment[]).filter((treatment) =>
    invoiceType === 'C' ? treatment === 'C_NO_VAT' : treatment !== 'C_NO_VAT',
  );
  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <p className="font-medium">
          Venta {source.saleNumber} · Total {money(source.total)}
        </p>
        <p>
          Emisor registrado: {source.issuer.legalName} · {source.issuer.taxId}
        </p>
        <p>
          Receptor: {source.recipient.legalName} · {source.recipient.taxId ?? 'Sin identificación informada'}
        </p>
        <p className="text-sm text-muted-foreground">Estos datos no confirman habilitación fiscal.</p>
      </div>
      <fieldset disabled={busy} className="space-y-4">
        <label className="flex max-w-sm flex-col gap-2">
          Clase propuesta
          <select
            className={selectClass}
            value={invoiceType}
            onChange={(event) => {
              setInvoiceType(event.target.value as FiscalInvoiceType | '');
              setTreatments({});
              changed();
            }}
          >
            <option value="">Seleccioná una clase</option>
            {['A', 'B', 'C'].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm">
          Elegí el tratamiento de cada renglón. La condición del emisor y del cliente deberá verificarse antes
          de emitir.
        </p>
        {source.lines.map((line) => (
          <div key={line.salesLineId} className="grid gap-2 rounded-lg border p-4 sm:grid-cols-2">
            <div>
              <p className="font-medium">{line.description}</p>
              <p className="text-sm">
                Cantidad {line.quantity} · Final {money(line.finalAmount)}
              </p>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Tratamiento: {line.description}
              <select
                className={selectClass}
                disabled={!invoiceType}
                value={treatments[line.salesLineId] ?? ''}
                onChange={(event) => {
                  const value = event.target.value as FiscalTaxTreatment;
                  setTreatments((previous) => ({ ...previous, [line.salesLineId]: value }));
                  changed();
                }}
              >
                <option value="">Seleccioná un tratamiento</option>
                {choices.map((treatment) => (
                  <option value={treatment} key={treatment}>
                    {FISCAL_TAX_TREATMENT_LABELS[treatment]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              changed();
            }}
          />
          Confirmo que los importes de la venta son finales e incluyen el IVA cuando corresponde. El desglose
          mantendrá el total de la venta.
        </label>
        <Button disabled={!complete || busy} onClick={() => void run(false)}>
          Calcular desglose
        </Button>
      </fieldset>
      <ErrorNotice error={error} />
      {Boolean(error) && (
        <p className="text-sm">
          Si otro usuario modificó el borrador, recargá para revisar la versión vigente antes de guardar.{' '}
          <button className={linkClass} onClick={() => window.location.reload()}>
            Recargar y descartar cambios locales
          </button>
        </p>
      )}
      {preview && (
        <>
          <Breakdown preview={preview} />
          <Button disabled={busy || !complete || Boolean(saved)} onClick={() => void run(true)}>
            {busy ? 'Guardando…' : 'Guardar borrador'}
          </Button>
        </>
      )}
      {saved && (
        <p role="status">
          Borrador guardado · Revisión {revision}.{' '}
          <Link className={linkClass} href={`/facturas-fiscales/${saved.id}`}>
            Ver detalle
          </Link>
        </p>
      )}
    </div>
  );
}
