'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  FISCAL_TAX_TREATMENT_LABELS,
  type FiscalDraftDto,
  type FiscalDraftInput,
  type FiscalInvoiceType,
  type FiscalPreview,
  type FiscalSource,
  type FiscalTaxTreatment,
} from '@erp/shared';
import { FiscalAuthorizationPanel } from './authorization';
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
export function FiscalListPage() {
  const access = useAccess();
  const [page, setPage] = useState(1);
  const query = useFiscalDrafts(page, access.read);
  if (access.loading) return <p>Cargando permisos…</p>;
  if (!access.read) return <p>No tenés permiso para consultar borradores fiscales.</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Borradores fiscales</h1>
      <Notice />
      {access.prepare && (
        <Link className={linkClass} href="/facturas-fiscales/nueva">
          Preparar desde una venta
        </Link>
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
                    <td>
                      <Link className={linkClass} href={`/facturas-fiscales/${draft.id}`}>
                        Ver borrador
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data.items.length === 0 && <p>Todavía no hay borradores fiscales.</p>}
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
      {!query.isError && query.data && (
        <>
          <p>
            Venta {query.data.draft.source.saleNumber} · {query.data.draft.source.recipient.legalName} ·
            Revisión {query.data.draft.revision}
          </p>
          <FiscalAuthorizationPanel
            key={`${query.data.draft.id}:${query.data.draft.revision}`}
            draft={query.data.draft}
            canPrepare={access.prepare}
          />
          <Breakdown preview={query.data.draft} />
        </>
      )}
    </div>
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
