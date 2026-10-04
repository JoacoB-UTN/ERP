'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  FISCAL_ISSUER_VAT_LABELS,
  saveFiscalSettingsSchema,
  type FiscalSettings,
  type FiscalIssuerVatCondition,
  type FiscalConnectivityResponse,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  authClient,
  useActiveCompany,
  usePermissions,
  useFiscalSettings,
  useSaveFiscalSettings,
  useCheckFiscalConnectivity,
} from '@/lib/auth-client';

const linkClass = 'text-primary underline underline-offset-4';
const fieldClass = 'rounded-md border bg-background p-2';
function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-destructive">
      {error instanceof Error ? error.message : 'No se pudo completar la operación.'}
    </p>
  ) : null;
}
export default function FiscalSettingsPage() {
  const { can, isLoading } = usePermissions();
  const allowed = !isLoading && can('configuration.manage');
  const query = useFiscalSettings(allowed);
  if (isLoading) return <p>Cargando permisos…</p>;
  if (!allowed) return <p>No tenés permiso para administrar la configuración fiscal.</p>;
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Configuración fiscal de pruebas</h1>
      <p>
        Entorno: <strong>Homologación de ARCA</strong>. Esta preparación no habilita la emisión de
        comprobantes.
      </p>
      {can('sales.invoices.read') && (
        <Link className={linkClass} href="/facturas-fiscales">
          Ver borradores fiscales
        </Link>
      )}
      {query.isPending && <p role="status">Cargando configuración…</p>}
      <ErrorNotice error={query.error} />
      {query.isError && (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Reintentar carga
        </Button>
      )}
      {query.data && <SettingsForm initial={query.data.settings} />}
    </div>
  );
}
export function SettingsForm({ initial }: { initial: FiscalSettings }) {
  const [settings, setSettings] = useState(initial);
  const [vat, setVat] = useState<FiscalIssuerVatCondition | ''>(initial.vatCondition ?? '');
  const [point, setPoint] = useState(initial.testPointOfSale?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [connectivity, setConnectivity] = useState<FiscalConnectivityResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const save = useSaveFiscalSettings();
  const check = useCheckFiscalConnectivity();
  const { activeCompanyId } = useActiveCompany();
  const mounted = useRef(true);
  const saving = useRef(false);
  const probing = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stillHere = () =>
    mounted.current && authClient.companyContextStore.getActiveCompanyId() === activeCompanyId;
  async function saveSettings() {
    if (saving.current || !stillHere()) return;
    setMessage('');
    setError(null);
    const parsed = saveFiscalSettingsSchema.safeParse({
      vatCondition: vat || null,
      testPointOfSale: point === '' ? null : Number(point),
      expectedRevision: settings.revision,
    });
    if (!parsed.success || (point !== '' && !/^\d{1,5}$/.test(point))) {
      setError(
        new Error(
          'El punto de venta debe ser un entero entre 1 y 99999, o quedar vacío si todavía no está definido.',
        ),
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const response = await save.mutateAsync(parsed.data);
      if (stillHere()) {
        setSettings(response.settings);
        setMessage('Configuración guardada. La emisión continúa pendiente.');
      }
    } catch (cause) {
      if (stillHere()) setError(cause);
    } finally {
      saving.current = false;
      if (stillHere()) setBusy(false);
    }
  }
  async function probe() {
    if (probing.current || !stillHere()) return;
    probing.current = true;
    setChecking(true);
    setConnectivity(null);
    try {
      const response = await check.mutateAsync();
      if (stillHere()) setConnectivity(response);
    } catch (cause) {
      if (stillHere()) setError(cause);
    } finally {
      probing.current = false;
      if (stillHere()) setChecking(false);
    }
  }
  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4 space-y-2">
        <h2 className="font-semibold">Empresa emisora registrada</h2>
        <p>{settings.issuer.legalName}</p>
        <p>CUIT: {settings.issuer.taxId || 'Sin informar'}</p>
        <p className="text-sm">
          {settings.issuer.taxIdFormatValid
            ? 'Formato y dígito verificador correctos; inscripción en ARCA sin verificar.'
            : 'El CUIT registrado necesita revisión antes de emitir.'}
        </p>
        <p className="text-sm text-muted-foreground">
          La identidad se toma de los datos de la empresa. No se modifica desde esta pantalla.
        </p>
      </section>
      <fieldset disabled={busy} className="space-y-4">
        <label className="flex flex-col gap-2">
          Condición frente al IVA (declarada)
          <select
            className={fieldClass}
            value={vat}
            onChange={(event) => {
              setVat(event.target.value as FiscalIssuerVatCondition | '');
              setMessage('');
            }}
          >
            <option value="">Todavía no definida</option>
            {Object.entries(FISCAL_ISSUER_VAT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          Punto de venta de pruebas
          <input
            className={fieldClass}
            inputMode="numeric"
            maxLength={5}
            value={point}
            onChange={(event) => {
              setPoint(event.target.value);
              setMessage('');
            }}
            placeholder="Pendiente de definir"
          />
        </label>
        <p className="text-sm">
          Guardá únicamente los datos que conozcas. El número declarado no acredita su alta ni su habilitación
          para Web Services.
        </p>
        <Button onClick={() => void saveSettings()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar configuración'}
        </Button>
      </fieldset>
      <ErrorNotice error={error} />
      {Boolean(error) && (
        <button className={linkClass} onClick={() => window.location.reload()}>
          Recargar configuración y descartar cambios locales
        </button>
      )}
      {message && <p role="status">{message}</p>}
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">Disponibilidad del servicio de pruebas</h2>
        <p className="text-sm">
          Consulta pública desde el servidor del ERP. No envía datos fiscales ni facturas y no verifica tus
          certificados.
        </p>
        <Button variant="outline" disabled={checking} onClick={() => void probe()}>
          {checking ? 'Comprobando…' : 'Comprobar disponibilidad de ARCA'}
        </Button>
        {connectivity && (
          <div role="status" className="space-y-2">
            <p>{connectivity.message}</p>
            <p className="text-sm">Consulta: {new Date(connectivity.checkedAt).toLocaleString('es-AR')}</p>
            {connectivity.services && (
              <ul className="text-sm">
                <li>
                  Aplicación: {connectivity.services.application === 'OK' ? 'Disponible' : 'No disponible'}
                </li>
                <li>
                  Base de datos: {connectivity.services.database === 'OK' ? 'Disponible' : 'No disponible'}
                </li>
                <li>
                  Servicio de autenticación:{' '}
                  {connectivity.services.authentication === 'OK' ? 'Disponible' : 'No disponible'}
                </li>
              </ul>
            )}
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Pendientes según la configuración guardada</h2>
        <ul className="list-disc pl-5">
          {settings.pendingRequirements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-sm">
          Los certificados y sus claves privadas no se cargan aquí ni se comparten por chat. La conexión
          autenticada se implementará en la próxima etapa.
        </p>
        <a
          className={linkClass}
          href="https://www.arca.gob.ar/ws/documentacion/wsaa.asp"
          target="_blank"
          rel="noreferrer"
        >
          Guía oficial de certificados de homologación y asociación al servicio
        </a>
      </section>
    </div>
  );
}
