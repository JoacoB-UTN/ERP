'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
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
import { PosCart } from './pos-cart';
import { PaymentPanel } from './payment-panel';

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
  const [savedSaleId, setSavedSaleId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [successSale, setSuccessSale] = useState<SalesDocumentDetailDto | null>(null);

  const searchRef = useRef<ProductSearchHandle>(null);
  const customerRef = useRef<CustomerPickerHandle>(null);
  const companyRef = useRef<string | null>(companyId);

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

  useEffect(() => {
    function canOpenCheckout() {
      return canConfirm && !successSale && customer !== null && lines.length > 0 && !checkoutOpen;
    }
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if (e.key === 'F2') {
        e.preventDefault();
        if (customer) {
          setCustomer(null);
          setTimeout(() => customerRef.current?.focus(), 0);
        } else {
          customerRef.current?.focus();
        }
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        if (canOpenCheckout()) {
          setError(undefined);
          setCheckoutError(undefined);
          setCheckoutOpen(true);
        }
        return;
      }
      if (inField) return; // never hijack normal typing in the search/customer inputs
      if (e.key === '+' && activeKey) {
        e.preventDefault();
        bumpQuantity(activeKey, 1);
      } else if (e.key === '-' && activeKey) {
        e.preventDefault();
        bumpQuantity(activeKey, -1);
      } else if (e.key === 'Delete' && activeKey) {
        e.preventDefault();
        removeLine(activeKey);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [customer, activeKey, lines.length, canConfirm, successSale, checkoutOpen]);

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

  /** Never called per scanned line — only at checkout (F10/Cobrar), see docs/pos.md. */
  async function persistDraft(): Promise<string | null> {
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

  function handleOpenCheckout() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(undefined);
    setCheckoutError(undefined);
    setCheckoutOpen(true);
  }

  async function handleCheckoutConfirm(tender: ConfirmSaleTenderInput) {
    setConfirming(true);
    setCheckoutError(undefined);
    try {
      const id = await persistDraft();
      if (!id) {
        setCheckoutOpen(false);
        return;
      }
      const result = await confirmSale.mutateAsync({ id, tender });
      setCheckoutOpen(false);
      setSuccessSale(result.salesDocument);
    } catch (err) {
      // Keep the panel open (insufficient stock, a price/customer race,
      // ...) — the draft is already saved, so the operator can adjust the
      // cart and retry without losing the sale. See docs/pos.md.
      setCheckoutError(saleErrorMessage(err));
    } finally {
      setConfirming(false);
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
      <div className="flex max-w-md flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-600">Venta confirmada</p>
          <h1 className="text-2xl font-semibold tracking-tight">{successSale.number}</h1>
        </div>
        <div className="rounded-lg border border-border p-4 text-sm">
          <p>{successSale.customer.legalName}</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(successSale.total, successSale.currencyCode)}</p>
          {tender && (
            <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pago</span>
                <span className="font-medium">{salesTenderMethodLabel(tender.method)}</span>
              </div>
              {tender.amountReceived !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recibido</span>
                  <span className="tabular-nums">{formatMoney(tender.amountReceived, successSale.currencyCode)}</span>
                </div>
              )}
              {tender.change !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vuelto</span>
                  <span className="font-medium tabular-nums">{formatMoney(tender.change, successSale.currencyCode)}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleNewSale} autoFocus>
            Nueva venta
          </Button>
          <Link href={`/ventas/${successSale.id}`} className={buttonVariants({ variant: 'outline' })}>
            Ver venta
          </Link>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            Imprimir comprobante interno
          </Button>
        </div>
        <PrintReceipt sale={successSale} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Cliente (F2)</p>
          <CustomerPicker ref={customerRef} value={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Producto</p>
          <ProductSearch ref={searchRef} warehouseId={activeWarehouseId} priceListId={activePriceListId} onSelect={addLine} />
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {activeKey ? '+ / − cantidad de la línea seleccionada · Supr para quitarla' : 'Seleccioná una línea para editar la cantidad'}
        </p>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-bold tabular-nums">
              {currencyCode ? formatMoney(String(totals.total), currencyCode) : '—'}
            </p>
          </div>
          {canConfirm ? (
            <Button type="button" size="lg" onClick={handleOpenCheckout} disabled={lines.length === 0}>
              Cobrar (F10)
            </Button>
          ) : (
            <p className="max-w-40 text-xs text-muted-foreground">No tenés permiso para cobrar.</p>
          )}
        </div>
      </div>

      <PaymentPanel
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        total={totals.total}
        currencyCode={currencyCode}
        onConfirm={handleCheckoutConfirm}
        pending={confirming}
        error={checkoutError}
      />
    </div>
  );
}
