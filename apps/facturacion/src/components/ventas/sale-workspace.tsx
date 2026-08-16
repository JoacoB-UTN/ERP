'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Printer } from 'lucide-react';
import { formatMoney, type SalesDocumentDetailDto } from '@erp/shared';
import {
  usePermissions,
  useActiveWarehouse,
  useActivePriceList,
  useActiveCompanyId,
  useSale,
  useCreateSale,
  useUpdateSale,
  useConfirmSale,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { CustomerPicker, type CustomerPickerSelection } from './customer-picker';
import { ProductSearch, type ProductSearchHandle, type ProductSearchSelection } from './product-search';
import { SaleLinesTable, SaleTotals, computeCartTotals, toSaleLineInputs, type SaleLineDraft } from './cart';
import { usePriceMap } from './use-price-map';
import { ConfirmSaleDialog } from './confirm-sale-dialog';
import { SaleReadOnly } from './sale-readonly';
import { PrintReceipt } from './print-receipt';
import { saleErrorMessage } from './ventas-errors';

/**
 * `/ventas/nueva` and `/ventas/[id]` are separate page components, so
 * `router.replace()` between them fully unmounts/remounts `SaleWorkspace`
 * — any `error` set just before that navigate is otherwise lost before it
 * ever paints (found during Prompt #13 hardening: confirming an
 * insufficient-stock draft from a blank workspace silently showed no
 * error at all). Stashed here right before the navigate, consumed once by
 * the freshly-mounted destination instance below.
 */
const CONFIRM_ERROR_STORAGE_KEY = 'facturacion:sale-workspace:confirm-error';

/**
 * The main Facturación operational workspace — used for both a brand new
 * sale (`saleId: null`) and continuing/confirming an existing DRAFT
 * (`saleId` set). Warehouse and price list are never re-implemented here
 * — they ARE the topbar's `useActiveWarehouse`/`useActivePriceList`
 * selectors (see docs/facturacion.md and AGENTS.md's "don't duplicate
 * shared context infrastructure" rule). Everything here calls the same
 * `SalesService` API Gestión's `/ventas` uses — no parallel sales domain.
 */
export function SaleWorkspace({ saleId }: { saleId: string | null }) {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const companyId = useActiveCompanyId();
  const { activeWarehouseId, isLoading: warehouseLoading, hasNoEligibleWarehouses } = useActiveWarehouse();
  const {
    activePriceListId,
    activePriceList,
    isLoading: priceListLoading,
    hasNoEligibleLists,
  } = useActivePriceList();

  const saleQuery = useSale(saleId);
  const createSale = useCreateSale();
  const updateSale = useUpdateSale();
  const confirmSale = useConfirmSale();

  const [customer, setCustomer] = useState<CustomerPickerSelection | null>(null);
  const [lines, setLines] = useState<SaleLineDraft[]>([]);
  const [savedSaleId, setSavedSaleId] = useState<string | null>(saleId);
  const [error, setError] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [successSale, setSuccessSale] = useState<SalesDocumentDetailDto | null>(null);
  const [repriceNotice, setRepriceNotice] = useState(false);

  const searchRef = useRef<ProductSearchHandle>(null);
  const loadedFromSale = useRef(false);
  const priceListRef = useRef<string | null>(null);
  const companyRef = useRef<string | null>(companyId);

  const currencyCode = activePriceList?.currencyCode ?? null;

  // Pick up an error stashed by a confirm-failure redirect (see
  // CONFIRM_ERROR_STORAGE_KEY above) — a one-time consume, not a
  // persistent state restore. Read + remove happen INSIDE the deferred
  // callback (not before scheduling it) so React 18 Strict Mode's dev
  // double-invoke (mount -> cleanup -> mount) can't consume the stash on
  // a pass that then gets cancelled — cleanup here only ever cancels a
  // still-pending timeout, never touches sessionStorage itself.
  useEffect(() => {
    if (!saleId) return;
    const id = setTimeout(() => {
      const stashed = sessionStorage.getItem(CONFIRM_ERROR_STORAGE_KEY);
      if (!stashed) return;
      sessionStorage.removeItem(CONFIRM_ERROR_STORAGE_KEY);
      setError(stashed);
    }, 0);
    return () => clearTimeout(id);
  }, [saleId]);

  // Populate local editing state once from an existing DRAFT sale.
  useEffect(() => {
    const sale = saleQuery.data?.salesDocument;
    if (!sale || loadedFromSale.current || sale.status !== 'DRAFT') return;
    loadedFromSale.current = true;
    setCustomer({
      customerId: sale.customer.id,
      displayName: sale.customer.legalName,
      code: sale.customer.code,
      taxId: null,
      taxCondition: null,
    });
    setLines(
      sale.lines.map((l) => ({
        key: l.id,
        variantId: l.productVariantId,
        label: l.description,
        sku: l.sku,
        productType: 'PRODUCT',
        quantity: l.quantity,
        discountPercentage: l.discountPercentage,
      })),
    );
  }, [saleQuery.data]);

  // Reprice notice: skip the very first assignment, only fire on a real change while a cart exists.
  useEffect(() => {
    if (priceListRef.current === null) {
      priceListRef.current = activePriceListId;
      return undefined;
    }
    if (activePriceListId !== priceListRef.current) {
      priceListRef.current = activePriceListId;
      if (lines.length > 0) {
        const showTimer = setTimeout(() => setRepriceNotice(true), 0);
        const hideTimer = setTimeout(() => setRepriceNotice(false), 4000);
        return () => {
          clearTimeout(showTimer);
          clearTimeout(hideTimer);
        };
      }
    }
    return undefined;
    // lines intentionally omitted — this only reacts to the price list changing, not every cart edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePriceListId]);

  // Company isolation: a draft-in-progress from a previous company context must never silently
  // carry over — see docs/facturacion.md and AGENTS.md's company-scoping rule.
  useEffect(() => {
    if (companyRef.current === null) {
      companyRef.current = companyId;
      return;
    }
    if (companyId !== companyRef.current) {
      companyRef.current = companyId;
      setCustomer(null);
      setLines([]);
      setSavedSaleId(null);
      setError(undefined);
      loadedFromSale.current = false;
      if (saleId) router.replace('/ventas/nueva');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const { prices: priceMap } = usePriceMap(
    activePriceListId,
    lines.map((l) => l.variantId),
  );
  const totals = computeCartTotals(lines, priceMap);

  const canCreate = can('sales.documents.create');
  const canUpdate = can('sales.documents.update');
  const canConfirm = can('sales.documents.confirm');
  const canEdit = savedSaleId ? canUpdate : canCreate;

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Enter' && canConfirmNow()) {
        e.preventDefault();
        setConfirmOpen(true);
      }
    }
    function canConfirmNow() {
      return canConfirm && !successSale && customer !== null && lines.length > 0 && !confirmOpen;
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canConfirm, successSale, customer, lines.length, confirmOpen]);

  function addLine(selection: ProductSearchSelection) {
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === selection.variantId);
      if (existing) {
        return prev.map((l) =>
          l.key === existing.key ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l,
        );
      }
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          variantId: selection.variantId,
          label: selection.label,
          sku: selection.sku,
          productType: selection.productType,
          quantity: '1',
          discountPercentage: '0',
        },
      ];
    });
  }

  function validate(): string | undefined {
    if (!customer) return 'Elegí un cliente.';
    if (!activeWarehouseId) return 'Elegí un depósito.';
    if (!activePriceListId) return 'Elegí una lista de precios.';
    if (lines.length === 0) return 'Agregá al menos un producto.';
    if (lines.some((l) => !l.quantity || Number(l.quantity) <= 0)) {
      return 'Todas las líneas necesitan una cantidad mayor a cero.';
    }
    return undefined;
  }

  async function persistDraft(): Promise<string | null> {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return null;
    }
    setError(undefined);
    try {
      if (savedSaleId) {
        await updateSale.mutateAsync({
          id: savedSaleId,
          input: {
            customerId: customer!.customerId,
            warehouseId: activeWarehouseId!,
            priceListId: activePriceListId!,
            lines: toSaleLineInputs(lines),
          },
        });
        return savedSaleId;
      }
      const result = await createSale.mutateAsync({
        customerId: customer!.customerId,
        warehouseId: activeWarehouseId!,
        priceListId: activePriceListId!,
        lines: toSaleLineInputs(lines),
      });
      setSavedSaleId(result.salesDocument.id);
      return result.salesDocument.id;
    } catch (err) {
      setError(saleErrorMessage(err));
      return null;
    }
  }

  async function handleSaveDraft() {
    const id = await persistDraft();
    if (id && id !== saleId) router.push(`/ventas/${id}`);
  }

  function handleConfirmClick() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(undefined);
    setConfirmOpen(true);
  }

  async function handleConfirmSubmit() {
    setConfirming(true);
    let id: string | null = null;
    try {
      id = await persistDraft();
      if (!id) {
        setConfirmOpen(false);
        return;
      }
      const result = await confirmSale.mutateAsync({ id });
      setConfirmOpen(false);
      setSuccessSale(result.salesDocument);
    } catch (err) {
      setConfirmOpen(false);
      const message = saleErrorMessage(err);
      setError(message);
      // Reconcile against the backend's actual state — e.g. another session
      // consumed the stock this confirm needed (see docs/facturacion.md's
      // insufficient-stock-race behavior). If we drafted straight from a
      // blank workspace, move to the sale's own route so its state (and any
      // retry) reflects reality instead of a stale blank-cart URL. That
      // navigate unmounts this component before the error above ever
      // paints, so stash it for the destination instance to pick up.
      if (id && !saleId) {
        sessionStorage.setItem(CONFIRM_ERROR_STORAGE_KEY, message);
        router.replace(`/ventas/${id}`);
      } else {
        void saleQuery.refetch();
      }
    } finally {
      setConfirming(false);
    }
  }

  function handleNewSale() {
    setCustomer(null);
    setLines([]);
    setSavedSaleId(null);
    setSuccessSale(null);
    setError(undefined);
    loadedFromSale.current = false;
    router.push('/ventas/nueva');
  }

  if (permissionsLoading || warehouseLoading || priceListLoading || (saleId && saleQuery.isLoading)) {
    return <div className="h-40" />;
  }

  if (saleId && !saleQuery.data) {
    return <p className="text-sm text-muted-foreground">No se encontró la venta.</p>;
  }

  if (successSale) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-600">Venta confirmada</p>
          <h1 className="text-2xl font-semibold tracking-tight">{successSale.number}</h1>
        </div>
        <div className="rounded-lg border border-border p-3 text-sm">
          <p>{successSale.customer.legalName}</p>
          <p className="mt-1 text-lg font-semibold">{formatMoney(successSale.total, successSale.currencyCode)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleNewSale}>
            Nueva venta
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              // Confirming straight from a blank /ventas/nueva means the route never
              // changed — navigate there for real. Confirming from an already-loaded
              // /ventas/:id means we're already on the right URL; just drop the
              // success overlay to reveal the (now-CONFIRMED) detail underneath.
              if (!saleId) {
                router.push(`/ventas/${successSale.id}`);
              } else {
                setSuccessSale(null);
              }
            }}
          >
            Ver operación
          </Button>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            Imprimir comprobante interno
          </Button>
        </div>
        <PrintReceipt sale={successSale} />
      </div>
    );
  }

  const loadedSale = saleQuery.data?.salesDocument;
  if (loadedSale && loadedSale.status !== 'DRAFT') {
    return <SaleReadOnly sale={loadedSale} />;
  }

  if (!canEdit) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para {savedSaleId ? 'editar' : 'crear'} ventas.</p>;
  }

  if (hasNoEligibleWarehouses || hasNoEligibleLists) {
    return (
      <p className="max-w-prose text-sm text-muted-foreground">
        Elegí un depósito y una lista de precios activos en la barra superior para empezar una venta.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Cliente</p>
          <CustomerPicker value={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} autoFocus={!customer} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Producto (Ctrl+K)</p>
          <ProductSearch
            ref={searchRef}
            warehouseId={activeWarehouseId}
            priceListId={activePriceListId}
            onSelect={addLine}
          />
        </div>
      </div>

      {repriceNotice && (
        <p className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700">
          Se actualizaron los precios según {activePriceList?.name}.
        </p>
      )}

      <SaleLinesTable
        lines={lines}
        priceMap={priceMap}
        currencyCode={currencyCode}
        onChange={(key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))}
        onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
      />

      <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={createSale.isPending || updateSale.isPending}>
            {createSale.isPending || updateSale.isPending ? 'Guardando…' : 'Guardar borrador'}
          </Button>
          {canConfirm && (
            <Button type="button" onClick={handleConfirmClick} disabled={lines.length === 0}>
              Confirmar venta
            </Button>
          )}
        </div>
        <div className="w-full max-w-xs">
          <SaleTotals subtotal={totals.subtotal} discountTotal={totals.discountTotal} total={totals.total} currencyCode={currencyCode} />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ConfirmSaleDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        customerName={customer?.displayName ?? ''}
        total={totals.total}
        currencyCode={currencyCode}
        onConfirm={handleConfirmSubmit}
        pending={confirming}
      />
    </div>
  );
}
