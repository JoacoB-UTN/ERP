'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { ApiError } from '@erp/auth-client';
import {
  PRICE_IMPORT_ROW_STATUS_LABELS,
  priceImportRowStatusValues,
  type PriceExportQuery,
  type PriceImportPreviewDto,
  type PriceImportResultDto,
  type PriceImportRowStatus,
} from '@erp/shared';

import {
  useApplyPriceImport,
  useApplyTangoImport,
  useExportPrices,
  usePreviewPriceImport,
  usePreviewTangoImport,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';

type Mode = 'tango' | 'edit';

const STATUS_TONE: Record<PriceImportRowStatus, 'success' | 'neutral' | 'warning' | 'danger'> = {
  WILL_UPDATE: 'success',
  UNCHANGED: 'neutral',
  NOT_FOUND: 'warning',
  AMBIGUOUS: 'danger',
  INVALID_PRICE: 'danger',
};

/**
 * Saves a downloaded blob under the name the server chose.
 *
 * An object URL and a synthetic click, because the file arrives through
 * `fetch` (it needs the session cookie and the company header, which a plain
 * `<a href>` cannot carry). The URL is revoked straight away — it pins the
 * blob in memory until it is, and a price export can be megabytes.
 */
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Bringing prices in and out of a price list as spreadsheets.
 *
 * One dialog, two modes, because they are the same act from the user's side
 * — "update these prices from a file" — and differ only in which file. The
 * Tango mode reads that system's own export untouched; the edit mode is the
 * round trip through our own workbook.
 *
 * Both are preview-then-apply and the apply button stays disabled until a
 * preview has run. The preview is produced by the same code path that does
 * the writing, so the counts shown are what will happen, not an estimate of
 * it — and a file whose preview says nothing will change cannot be applied
 * at all.
 */
export function PriceFileDialog({
  priceListId,
  isFixedList,
  filters,
  selectedVariantIds,
  disabled,
}: {
  priceListId: string;
  /** Only FIXED lists have prices of their own; a DERIVED list computes them. */
  isFixedList: boolean;
  filters?: Partial<PriceExportQuery>;
  selectedVariantIds?: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('edit');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PriceImportPreviewDto | null>(null);
  const [result, setResult] = useState<PriceImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const exportPrices = useExportPrices();
  const previewTango = usePreviewTangoImport();
  const applyTango = useApplyTangoImport();
  const previewEdit = usePreviewPriceImport();
  const applyEdit = useApplyPriceImport();

  const previewMutation = mode === 'tango' ? previewTango : previewEdit;
  const applyMutation = mode === 'tango' ? applyTango : applyEdit;
  const busy = previewMutation.isPending || applyMutation.isPending || exportPrices.isPending;

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function switchMode(next: Mode) {
    setMode(next);
    // The preview belongs to one file read one way; keeping it across a mode
    // switch would show counts from the other reader.
    reset();
  }

  async function handleExport() {
    setError(null);
    try {
      const { blob, fileName } = await exportPrices.mutateAsync({
        priceListId,
        filters,
        variantIds: selectedVariantIds,
      });
      saveBlob(blob, fileName ?? 'precios.xlsx');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No pudimos generar el archivo.');
    }
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function handlePreview() {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const res = await previewMutation.mutateAsync({ priceListId, file });
      setPreview(res.preview);
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : 'No pudimos leer el archivo.');
    }
  }

  async function handleApply() {
    if (!file) return;
    setError(null);
    try {
      const res = await applyMutation.mutateAsync({ priceListId, file });
      setPreview(res.preview);
      setResult(res.result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No pudimos aplicar los cambios.');
    }
  }

  const willUpdate = preview?.counts.WILL_UPDATE ?? 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <FileSpreadsheet className="size-3.5" />
        Precios por Excel
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogTitle>Precios por Excel</DialogTitle>
          <DialogDescription>
            {isFixedList
              ? 'Importá una lista exportada de Tango, o descargá los precios actuales, editalos y volvé a subirlos.'
              : 'Esta lista calcula sus precios a partir de otra, así que no se pueden importar precios propios.'}
          </DialogDescription>

          {isFixedList && (
            <>
              <div
                role="radiogroup"
                aria-label="Tipo de archivo"
                className="mt-4 inline-flex rounded-md border border-border bg-card p-0.5"
              >
                {(
                  [
                    ['edit', 'Editar en Excel'],
                    ['tango', 'Importar de Tango'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => switchMode(value)}
                    className={cn(
                      'rounded-[0.3125rem] px-3 py-1 text-[0.8125rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                      mode === value
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'edit' && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">1. Descargá los precios</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedVariantIds && selectedVariantIds.length > 0
                        ? `Se exportan los ${selectedVariantIds.length} productos seleccionados.`
                        : 'Se exportan los productos que estás viendo, con los filtros aplicados.'}{' '}
                      Completá la columna <strong>Precio nuevo</strong> solo en las filas que quieras
                      cambiar.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={busy}>
                    <Download className="size-3.5" />
                    {exportPrices.isPending ? 'Generando…' : 'Descargar Excel'}
                  </Button>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2">
                <label className="text-[0.8125rem] font-semibold" htmlFor="price-file">
                  {mode === 'edit' ? '2. Subí el archivo editado' : 'Subí el archivo de Tango'}
                </label>
                <input
                  id="price-file"
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleFile}
                  className="block w-full cursor-pointer rounded-md border border-input bg-card p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-sm file:font-medium file:text-foreground"
                />
              </div>

              {preview && <PreviewReport preview={preview} />}

              {result && (
                <p
                  role="status"
                  className="mt-3 rounded-md border border-success/25 bg-success-muted px-3 py-2 text-sm text-success"
                >
                  Se actualizaron {result.applied}{' '}
                  {result.applied === 1 ? 'precio' : 'precios'}, con vigencia desde{' '}
                  {result.effectiveFrom}.
                </p>
              )}

              {error && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {error}
                </p>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
              {result ? 'Cerrar' : 'Cancelar'}
            </Button>
            {isFixedList && !result && (
              <>
                <Button type="button" variant="outline" onClick={handlePreview} disabled={!file || busy}>
                  {previewMutation.isPending ? 'Analizando…' : 'Analizar archivo'}
                </Button>
                {/* Apply is unreachable until a preview exists and says
                    something will change: the point of the preview is that
                    nobody writes six thousand prices without seeing the count
                    first. */}
                <Button type="button" onClick={handleApply} disabled={!preview || willUpdate === 0 || busy}>
                  <Upload className="size-3.5" />
                  {applyMutation.isPending
                    ? 'Aplicando…'
                    : `Aplicar ${willUpdate > 0 ? willUpdate : ''} ${willUpdate === 1 ? 'cambio' : 'cambios'}`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * What the file will do, before it does it.
 *
 * The counts are over the whole file; the rows below are a sample capped per
 * status by the API, so every outcome present is visible even when one of
 * them dominates — an import against a fresh catalogue is thousands of
 * "no encontrado" and a handful of real updates, and it is the handful that
 * has to be readable.
 */
function PreviewReport({ preview }: { preview: PriceImportPreviewDto }) {
  const present = priceImportRowStatusValues.filter((s) => preview.counts[s] > 0);

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          {preview.fileRows} {preview.fileRows === 1 ? 'fila leída' : 'filas leídas'}
        </span>
        {present.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <StatusBadge tone={STATUS_TONE[status]}>{preview.counts[status]}</StatusBadge>
            <span className="text-muted-foreground">{PRICE_IMPORT_ROW_STATUS_LABELS[status]}</span>
          </span>
        ))}
      </div>

      {preview.sourcePriceListCodes.length > 0 && (
        // A cross-check against the commonest mistake: exporting list 3001
        // from Tango and importing it over the wrong list here.
        <p className="text-xs text-muted-foreground">
          El archivo corresponde a la lista de Tango{' '}
          {preview.sourcePriceListCodes.join(', ')}. Verificá que sea la que querés actualizar.
        </p>
      )}

      <div className="max-h-64 overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 text-left text-xs font-medium text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-1.5">Fila</th>
              <th className="px-3 py-1.5">Estado</th>
              <th className="px-3 py-1.5">Artículo</th>
              <th className="px-3 py-1.5 text-right">Actual</th>
              <th className="px-3 py-1.5 text-right">Nuevo</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={`${row.rowNumber}`} className="border-t border-border">
                <td className="px-3 py-1 tabular-nums text-muted-foreground">{row.rowNumber}</td>
                <td className="px-3 py-1">
                  <StatusBadge tone={STATUS_TONE[row.status]}>
                    {PRICE_IMPORT_ROW_STATUS_LABELS[row.status]}
                  </StatusBadge>
                </td>
                <td className="px-3 py-1">
                  <div className="truncate">{row.productName ?? row.description ?? '—'}</div>
                  {row.productName && row.description && (
                    <div className="truncate text-xs text-muted-foreground">{row.description}</div>
                  )}
                </td>
                <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">
                  {row.currentPrice ?? '—'}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{row.price ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview.sampleTruncated && (
        <p className="text-xs text-muted-foreground">
          Se muestra una parte de cada grupo. Los totales de arriba son sobre el archivo completo.
        </p>
      )}
    </div>
  );
}
