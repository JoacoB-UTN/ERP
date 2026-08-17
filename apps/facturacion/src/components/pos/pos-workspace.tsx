'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Printer } from 'lucide-react';
import { formatMoney, salesTenderMethodLabel } from '@erp/shared';
import type { SalesDocumentDetailDto, ConfirmSaleTenderInput } from '@erp/shared';
import {
  usePermissions,
  useActiveWarehouse,
  useActivePriceList,
  useActiveCompanyId,
  useCreateSale,
  useUpdateSale,
  useConfirmSale,
} from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { CustomerPicker, type CustomerPickerSelection, type CustomerPickerHandle } from '@/components/ventas/customer-picker';
import { ProductSearch, type ProductSearchHandle, type ProductSearchSelection } from '@/components/ventas/product-search';
import { computeCartTotals, toSaleLineInputs, type SaleLineDraft } from '@/components/ventas/cart';
import { usePriceMap } from '@/components/ventas/use-price-map';
import { saleErrorMessage } from '@/components/ventas/ventas-errors';
import { PrintReceipt } from '@/components/ventas/print-receipt';
import { cn } from '@/lib/utils';
import { PosCart } from './pos-cart';
import { PaymentPanel } from './payment-panel';
import { resolvePosKeydownAction } from './pos-keyboard';

/**
 * POS mode — a specialized, ultra-fast checkout screen inside Facturación
 * (see docs/pos.md), not a separate app or backend. Same Sales domain as
 * `/ventas/nueva` (SaleWorkspace): this component never talks to the API
 * directly for anything create/confirm/read.mutation.reset except through
 * the same `useCreateSale`/`useUpdateSale`/`useConfirmSale` hooks.
 *
 * Differences from the regular SaleWorkspace, all deliberate: no route-
 * scoped draft to resume (POS always starts a brand-new local cart — no
 * suspended-sale queue in this MVP); the customer persists across
 * consecutive sales in the same POS session instead of resetting on
 * "Nueva venta"; checkout happens through a payment panel (method +
 * cash/change) instead of a plain confirm dialog; an "active line" drives
 * keyboard quantity/remove shortcuts.
 */
export function PosWorkspace() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const companyId = useActiveCompanyId();
  const { activeWarehouseId, isLoading: warehouseLoading, hasNoEligibleWarehouses } = useActiveWarehouse();
  const { activePriceListId, activePriceList, isLoading: priceListLoading, hasNoEligibleLists } = useActivePriceList();

  const createSale = useCreateSale();
  const updateSale = useUpdateSale();
  const confirmSale = useConfirmSale();

  const [customer, setCustomer] = useState<CustomerPickerSelection | null>(null);
  const [lines, setLines] = useState<SaleLineDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // The editable DRAFT id — kept up to date across `persistDraft()` calls
  // (create once, update thereafter) while the operator is still building
  // the cart. Distinct from `checkoutSaleId` below: this one may point at
  // a sale whose lines no longer match what's on screen (the operator can
  // keep editing after cancelling checkout).
  const [savedSaleId, setSavedSaleId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // The FROZEN checkout snapshot — the exact persisted `SalesDocument` id
  // the operator is currently being shown a total for in `PaymentPanel`.
  // Set once, atomically with `checkoutTotal`, when checkout opens
  // (`handleOpenCheckout`); never touched again until the panel closes or
  // confirmation succeeds/fails. `handleCheckoutConfirm` MUST confirm this
  // exact id and MUST NOT call `persistDraft()` again — doing so could
  // reprice the sale after the operator already approved a different
  // total (see docs/pos.md). `checkoutSaleId === null` means "no frozen
  // snapshot" — the payment panel must not be actionable in that state.
  const [checkoutSaleId, setCheckoutSaleId] = useState<string | null>(null);
  // The backend-canonical decimal-string total belonging to
  // `checkoutSaleId` — NEVER the local `computeCartTotals` preview
  // number. See docs/pos.md and AGENTS.md's "never floating point for
  // money" rule: a JS-number preview total (e.g. from `0.10 * 3`) can
  // carry binary floating-point error that a plain `String()` wrap does
  // not remove.
  const [checkoutTotal, setCheckoutTotal] = useState<string | null>(null);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [successSale, setSuccessSale] = useState<SalesDocumentDetailDto | null>(null);

  const searchRef = useRef<ProductSearchHandle>(null);
  const customerRef = useRef<CustomerPickerHandle>(null);
  const companyRef = useRef<string | null>(companyId);
  // Holds the current render's keydown closure — see the keyboard-shortcut
  // effects below for why this exists (fixes a stale-closure bug found
  // during external review).
  const keydownHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  const currencyCode = activePriceList?.currencyCode ?? null;

  // Company isolation: a POS cart/customer from a previous company must
  // never silently survive a company switch — see docs/pos.md.
  useEffect(() => {
    if (companyRef.current === null) {
      companyRef.current = companyId;
      return;
    }
    if (companyId !== companyRef.current) {
      companyRef.current = companyId;
      setCustomer(null);
      setLines([]);
      setActiveKey(null);
      setSavedSaleId(null);
      setError(undefined);
      setSuccessSale(null);
      setCheckoutSaleId(null);
      setCheckoutTotal(null);
      setCheckoutOpen(false);
    }
  }, [companyId]);

  const { prices: priceMap } = usePriceMap(
    activePriceListId,
    lines.map((l) => l.variantId),
  );
  const totals = computeCartTotals(lines, priceMap);

  const canCreate = can('sales.documents.create');
  const canConfirm = can('sales.documents.confirm');
  const ready =
    !permissionsLoading && !warehouseLoading && !priceListLoading && canCreate && !hasNoEligibleWarehouses && !hasNoEligibleLists;

  // Product search gets initial focus the moment POS actually renders the
  // sellable workspace — not on PosWorkspace's own mount, which happens
  // while still showing a loading placeholder (no ProductSearch in the DOM yet).
  useEffect(() => {
    if (ready) searchRef.current?.focus();
  }, [ready]);

  // Re-derived after every render (no dependency array) so the handler
  // always closes over the LATEST customer/lines/checkout state. The
  // previous version kept a single handler alive across renders and only
  // rebuilt it when `lines.length` (used as a cheap proxy for "the cart
  // changed") changed — but bumping a line's quantity with +/- changes
  // `lines` without changing its length, so F10 could fire a
  // `handleOpenCheckout` closure that still saw the OLD quantity. Tracking
  // every piece of state `handleOpenCheckout`/`persistDraft` touch
  // (customer, lines, warehouse, price list, savedSaleId, ...) as explicit
  // effect deps would be fragile and easy to under-specify again; instead
  // the actual DOM listener (bound once, below) always calls through this
  // ref, which this effect keeps pointed at a fresh closure on every
  // render — there is no dependency array to get wrong.
  useEffect(() => {
    keydownHandlerRef.current = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const action = resolvePosKeydownAction({
        key: e.key,
        inField: target.tagName === 'INPUT' || target.tagName === 'TEXTAREA',
        // The payment dialog owns keyboard interaction while it's open,
        // opening, or confirming — global shortcuts must not reach the
        // customer/cart behind it.
        modalActive: checkoutOpen || openingCheckout || confirming,
        hasActiveKey: activeKey !== null,
        canOpenCheckout: canConfirm && !successSale && customer !== null && lines.length > 0,
      });
      if (!action) return;
      e.preventDefault();
      switch (action.type) {
        case 'toggle-customer':
          if (customer) {
            setCustomer(null);
            setTimeout(() => customerRef.current?.focus(), 0);
          } else {
            customerRef.current?.focus();
          }
          break;
        case 'open-checkout':
          void handleOpenCheckout();
          break;
        case 'bump-quantity':
          if (activeKey) bumpQuantity(activeKey, action.delta);
          break;
        case 'remove-line':
          if (activeKey) removeLine(activeKey);
          break;
      }
    };
  });

  // Bound exactly once — dispatches to whatever `keydownHandlerRef` points
  // at, which is always this render's freshest closure (see above).
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      keydownHandlerRef.current(e);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function addLine(selection: ProductSearchSelection) {
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === selection.variantId);
      if (existing) {
        setActiveKey(existing.key);
        return prev.map((l) =>
          l.key === existing.key ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l,
        );
      }
      const key = crypto.randomUUID();
      setActiveKey(key);
      return [
        ...prev,
        {
          key,
          variantId: selection.variantId,
          label: selection.label,
          sku: selection.sku,
          productType: selection.productType,
          quantity: '1',
          discountPercentage: '0',
        },
      ];
    });
    searchRef.current?.focus();
  }

  function bumpQuantity(key: string, delta: number) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const next = (Number(l.quantity) || 0) + delta;
        return next > 0 ? { ...l, quantity: String(next) } : l;
      }),
    );
  }

  function removeLine(key: string) {
    setLines((prev) => {
      const next = prev.filter((l) => l.key !== key);
      setActiveKey(next.length > 0 ? next[next.length - 1].key : null);
      return next;
    });
  }

  function validate(): string | undefined {
    if (!customer) return 'Elegí un cliente.';
    if (!activeWarehouseId) return 'No hay depósito de venta seleccionado.';
    if (!activePriceListId) return 'No hay lista de precios seleccionada.';
    if (lines.length === 0) return 'Agregá al menos un producto.';
    return undefined;
  }

  /**
   * Never called per scanned line — only once, at checkout (F10/Cobrar,
   * via `handleOpenCheckout`), see docs/pos.md. Returns the backend-
   * canonical `salesDocument.total` (a Prisma.Decimal-computed decimal
   * string) alongside the sale id — this, not `computeCartTotals`'s
   * JS-number preview, is the only value ever allowed to reach the
   * payment panel / tender flow. See AGENTS.md's "never floating point
   * for money" rule.
   *
   * MUST NOT be called again once a checkout snapshot (`checkoutSaleId`)
   * is frozen — `handleCheckoutConfirm` confirms that exact snapshot
   * without re-persisting, so the total the operator approved in
   * `PaymentPanel` can never silently drift before confirmation.
   */
  async function persistDraft(): Promise<{ id: string; total: string } | null> {
    try {
      if (savedSaleId) {
        const result = await updateSale.mutateAsync({
          id: savedSaleId,
          input: {
            customerId: customer!.customerId,
            warehouseId: activeWarehouseId!,
            priceListId: activePriceListId!,
            lines: toSaleLineInputs(lines),
          },
        });
        return { id: savedSaleId, total: result.salesDocument.total };
      }
      const result = await createSale.mutateAsync({
        customerId: customer!.customerId,
        warehouseId: activeWarehouseId!,
        priceListId: activePriceListId!,
        lines: toSaleLineInputs(lines),
      });
      setSavedSaleId(result.salesDocument.id);
      return { id: result.salesDocument.id, total: result.salesDocument.total };
    } catch (err) {
      setError(saleErrorMessage(err));
      return null;
    }
  }

  /**
   * Persists/updates the draft to obtain the backend-canonical total,
   * freezes it as the checkout snapshot (`checkoutSaleId`/`checkoutTotal`),
   * then opens the payment panel — never the other way around. If
   * persisting fails (missing price, invalid quantity, ...) the panel
   * must NOT open; `persistDraft` has already surfaced the operational
   * error via `setError`.
   */
  async function handleOpenCheckout() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(undefined);
    setCheckoutError(undefined);
    setOpeningCheckout(true);
    try {
      const result = await persistDraft();
      if (!result) return;
      setCheckoutSaleId(result.id);
      setCheckoutTotal(result.total);
      setCheckoutOpen(true);
    } finally {
      setOpeningCheckout(false);
    }
  }

  /**
   * Confirms the exact frozen checkout snapshot (`checkoutSaleId`) — see
   * the `checkoutSaleId` state comment. Deliberately does NOT call
   * `persistDraft()`: doing so would let a price/context change reprice
   * the sale between the moment the operator saw `checkoutTotal` in
   * `PaymentPanel` and the moment they clicked "Confirmar y cobrar",
   * confirming a total the operator never actually approved. The
   * backend's own `SalesService.confirm()` still independently derives
   * `SalesTender.amountApplied` from the persisted `SalesDocument.total`
   * and runs status flip + stock movement + tender creation in one
   * transaction — this fix only removes a redundant, unsafe client-side
   * re-persist, it changes no backend semantics.
   */
  async function handleCheckoutConfirm(tender: ConfirmSaleTenderInput) {
    if (!checkoutSaleId) {
      // No frozen snapshot to confirm — fail safely rather than invent
      // an id or fall back to persisting a new draft.
      setCheckoutOpen(false);
      return;
    }
    setConfirming(true);
    setCheckoutError(undefined);
    try {
      const confirmed = await confirmSale.mutateAsync({ id: checkoutSaleId, tender });
      setCheckoutOpen(false);
      setCheckoutSaleId(null);
      setCheckoutTotal(null);
      setSavedSaleId(null);
      setSuccessSale(confirmed.salesDocument);
    } catch (err) {
      // Keep the panel — and the frozen snapshot — open (insufficient
      // stock, a race, ...): the draft is already saved under
      // `checkoutSaleId`, so the operator can retry (e.g. a different
      // payment method) without losing it. Closing checkout (Escape/
      // Cancel) is still the only way to go edit the cart and force a
      // fresh snapshot. See docs/pos.md.
      setCheckoutError(saleErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  }

  /**
   * `PaymentPanel`'s `onOpenChange` — fires for every operator-driven
   * close (Cancel button, Escape, backdrop click), never for the
   * programmatic `setCheckoutOpen(false)` calls this component makes
   * itself (e.g. on successful confirmation), so there's no cleanup race
   * between this and `handleCheckoutConfirm`'s own success-path cleanup.
   * Discards the checkout snapshot but deliberately leaves `savedSaleId`
   * alone — the persisted DRAFT stays available for the operator to keep
   * editing and reopen checkout against later.
   */
  function handleCheckoutOpenChange(open: boolean) {
    setCheckoutOpen(open);
    if (!open) {
      setCheckoutSaleId(null);
      setCheckoutTotal(null);
      setCheckoutError(undefined);
    }
  }

  function handleNewSale() {
    // Customer intentionally NOT reset — see docs/pos.md's "customer
    // persistence" decision (the same buyer often makes several
    // consecutive POS purchases).
    setLines([]);
    setActiveKey(null);
    setSavedSaleId(null);
    setSuccessSale(null);
    setError(undefined);
    setCheckoutSaleId(null);
    setCheckoutTotal(null);
    setOpeningCheckout(false);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  if (permissionsLoading || warehouseLoading || priceListLoading) {
    return <div className="h-40" />;
  }

  if (!canCreate) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para iniciar una venta en POS.</p>;
  }

  if (hasNoEligibleWarehouses || hasNoEligibleLists) {
    return (
      <p className="max-w-prose text-sm text-muted-foreground">
        Elegí un depósito y una lista de precios activos en la barra superior para empezar a vender.
      </p>
    );
  }

  if (successSale) {
    const tender = successSale.tender;
    return (
      <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success-muted px-3 py-1 text-xs font-semibold tracking-wide text-success uppercase">
            <CheckCircle2 className="size-3.5" />
            Venta confirmada
          </span>
          <h1 className="text-3xl font-bold tracking-tight">{successSale.number}</h1>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-sm font-medium text-foreground">{successSale.customer.legalName}</p>
          <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums">
            {formatMoney(successSale.total, successSale.currencyCode)}
          </p>
          {tender && (
            <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pago</span>
                <span className="font-semibold">{salesTenderMethodLabel(tender.method)}</span>
              </div>
              {tender.amountReceived !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recibido</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(tender.amountReceived, successSale.currencyCode)}
                  </span>
                </div>
              )}
              {tender.change !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vuelto</span>
                  <span className="font-bold tabular-nums text-success">
                    {formatMoney(tender.change, successSale.currencyCode)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" size="lg" onClick={handleNewSale} autoFocus className="h-14 text-base">
            Nueva venta
          </Button>
          <div className="flex gap-2">
            <Link href={`/ventas/${successSale.id}`} className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}>
              Ver venta
            </Link>
            <Button type="button" variant="outline" onClick={() => window.print()} className="flex-1">
              <Printer className="size-4" />
              Imprimir comprobante
            </Button>
          </div>
        </div>
        <PrintReceipt sale={successSale} />
      </div>
    );
  }

  const customerNeedsAttention = error === 'Elegí un cliente.';

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[17rem_minmax(0,1fr)]">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <p className="text-xs font-semibold text-muted-foreground">Cliente</p>
            <span className="rounded border border-border bg-muted px-1 py-0.5 text-[0.625rem] leading-none font-semibold text-muted-foreground">
              F2
            </span>
          </div>
          <CustomerPicker
            ref={customerRef}
            value={customer}
            onSelect={setCustomer}
            onClear={() => setCustomer(null)}
            invalid={customerNeedsAttention}
            errorId="pos-customer-error"
          />
          {customerNeedsAttention && (
            <p id="pos-customer-error" className="mt-1.5 text-xs font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <div>
          <ProductSearch
            ref={searchRef}
            warehouseId={activeWarehouseId}
            priceListId={activePriceListId}
            onSelect={addLine}
            appearance="primary"
            shortcutHint={null}
          />
        </div>
      </div>

      <PosCart
        lines={lines}
        priceMap={priceMap}
        currencyCode={currencyCode}
        activeKey={activeKey}
        onSetActive={setActiveKey}
        onRemove={removeLine}
      />

      {error && !customerNeedsAttention && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {lines.length === 0
            ? ''
            : activeKey
              ? '+ / − cantidad de la línea seleccionada · Supr para quitarla'
              : 'Seleccioná una línea para editar la cantidad'}
        </p>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          {lines.length > 0 && (
            <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {lines.length} {lines.length === 1 ? 'línea' : 'líneas'}
            </p>
          )}
          <div className="text-right">
            <p className="text-xs font-medium text-muted-foreground">Total {currencyCode ?? ''}</p>
            <p className="text-3xl leading-9 font-bold tracking-tight tabular-nums">
              {currencyCode ? formatMoney(String(totals.total), currencyCode) : '—'}
            </p>
          </div>
          {canConfirm ? (
            <Button
              type="button"
              size="lg"
              onClick={() => void handleOpenCheckout()}
              disabled={lines.length === 0 || openingCheckout}
              className="h-14 shrink-0 px-6 text-base"
            >
              {openingCheckout ? (
                'Abriendo…'
              ) : (
                <>
                  Cobrar<span className="ml-1.5 font-normal opacity-75">· F10</span>
                </>
              )}
            </Button>
          ) : (
            <p className="max-w-40 text-xs text-muted-foreground">No tenés permiso para cobrar.</p>
          )}
        </div>
      </div>

      <PaymentPanel
        open={checkoutOpen}
        onOpenChange={handleCheckoutOpenChange}
        total={checkoutTotal ?? '0'}
        currencyCode={currencyCode}
        onConfirm={handleCheckoutConfirm}
        pending={confirming}
        error={checkoutError}
      />
    </div>
  );
}
