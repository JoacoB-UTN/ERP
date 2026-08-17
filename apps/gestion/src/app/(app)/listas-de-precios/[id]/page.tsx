'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Power, History as HistoryIcon, Plus } from 'lucide-react';
import {
  formatMoney,
  pricingModeLabel,
  adjustmentTypeLabel,
  priceChangeTypeLabel,
  type PriceListDto,
  type PriceListItemsQuery,
  type PriceListItemRowDto,
} from '@erp/shared';
import {
  usePermissions,
  usePriceList,
  usePriceListItems,
  usePriceListHistory,
  usePriceHistory,
  useSetPrices,
  useDeactivatePriceList,
  useReactivatePriceList,
  useProductCategories,
  useBrands,
} from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Unauthorized } from '@/components/layout/unauthorized';
import { pricingErrorMessage } from '@/components/pricing/pricing-errors';
import { PriceListHistoryItem } from '@/components/pricing/price-list-history-item';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

type TabKey = 'resumen' | 'precios' | 'historial';
const PAGE_SIZE = 25;

export default function ListaDePreciosDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const priceListQuery = usePriceList(id ?? null);

  if (permissionsLoading || priceListQuery.isLoading) {
    return null;
  }
  const priceList = priceListQuery.data?.priceList;
  if (!can('pricing.lists.read') || !priceList) {
    return <Unauthorized />;
  }

  return (
    <ListaDePreciosDetailView
      priceList={priceList}
      canUpdate={can('pricing.lists.update')}
      canDeactivate={can('pricing.lists.deactivate')}
      canReadPrices={can('pricing.prices.read')}
      canUpdatePrices={can('pricing.prices.update')}
      canBulkUpdate={can('pricing.prices.bulk_update')}
    />
  );
}

function ListaDePreciosDetailView({
  priceList,
  canUpdate,
  canDeactivate,
  canReadPrices,
  canUpdatePrices,
  canBulkUpdate,
}: {
  priceList: PriceListDto;
  canUpdate: boolean;
  canDeactivate: boolean;
  canReadPrices: boolean;
  canUpdatePrices: boolean;
  canBulkUpdate: boolean;
}) {
  const [tab, setTab] = useState<TabKey>('resumen');
  const deactivate = useDeactivatePriceList();
  const reactivate = useReactivatePriceList();

  async function handleToggleStatus() {
    if (priceList.active) {
      if (!window.confirm(`¿Desactivar la lista de precios "${priceList.name}"?`)) return;
      await deactivate.mutateAsync(priceList.id);
    } else {
      await reactivate.mutateAsync(priceList.id);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'resumen', label: 'Resumen' },
    ...(canReadPrices ? [{ key: 'precios' as const, label: 'Precios' }] : []),
    { key: 'historial', label: 'Historial y auditoría' },
  ];

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{priceList.name}<StatusBadge status={priceList.active ? 'ACTIVE' : 'INACTIVE'}>{priceList.active ? 'Activa' : 'Inactiva'}</StatusBadge>{priceList.isDefault && <StatusBadge tone="info">Predeterminada</StatusBadge>}</span>}
        description={`${priceList.code} · ${pricingModeLabel(priceList.pricingMode)} · ${priceList.currencyCode}`}
        backHref="/listas-de-precios"
        backLabel="Listas de precios"
        actions={<>
          {canUpdate && (
            <Link href={`/listas-de-precios/${priceList.id}/editar`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil className="size-4" />
              Editar
            </Link>
          )}
          {canDeactivate && (
            <Button
              type="button"
              variant={priceList.active ? 'destructive' : 'outline'}
              onClick={handleToggleStatus}
              disabled={deactivate.isPending || reactivate.isPending}
            >
              <Power className="size-4" />
              {priceList.active ? 'Desactivar' : 'Reactivar'}
            </Button>
          )}
        </>}
      />

      <div role="tablist" aria-label="Secciones de la lista" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.key
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <ResumenTab priceList={priceList} />}
      {tab === 'precios' && canReadPrices && (
        <PreciosTab priceList={priceList} canUpdatePrices={canUpdatePrices} canBulkUpdate={canBulkUpdate} />
      )}
      {tab === 'historial' && <HistorialTab priceListId={priceList.id} />}
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? '—'}</dd>
    </div>
  );
}

function ResumenTab({ priceList }: { priceList: PriceListDto }) {
  return (
    <div className="flex flex-col gap-4">
      {priceList.pricingMode === 'DERIVED' && (
        <div className="rounded-md border border-border bg-accent/40 p-4 text-sm">
          Esta lista se calcula desde <span className="font-medium">{priceList.basePriceListName}</span>. Ajuste:{' '}
          <span className="font-medium">
            {priceList.adjustmentType && adjustmentTypeLabel(priceList.adjustmentType)}{' '}
            {priceList.adjustmentValue}
            {priceList.adjustmentType?.startsWith('PERCENTAGE') ? '%' : ''}
          </span>
          . Los precios se calculan al momento de la consulta — nunca se duplican como precios fijos.
        </div>
      )}
      <dl className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
        <SummaryField label="Código" value={priceList.code} />
        <SummaryField label="Moneda" value={`${priceList.currencyCode} (${priceList.currencySymbol})`} />
        <SummaryField label="Tipo" value={pricingModeLabel(priceList.pricingMode)} />
        <SummaryField label="Incluye impuestos" value={priceList.includesTax ? 'Sí' : 'No'} />
        <SummaryField label="Predeterminada" value={priceList.isDefault ? 'Sí' : 'No'} />
        <SummaryField label="Estado" value={priceList.active ? 'Activa' : 'Inactiva'} />
        {priceList.description && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Descripción</dt>
            <dd className="text-sm whitespace-pre-wrap">{priceList.description}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function PreciosTab({
  priceList,
  canUpdatePrices,
  canBulkUpdate,
}: {
  priceList: PriceListDto;
  canUpdatePrices: boolean;
  canBulkUpdate: boolean;
}) {
  const categoriesQuery = useProductCategories();
  const brandsQuery = useBrands();
  const setPrices = useSetPrices();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [hasPrice, setHasPrice] = useState('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(variantId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const itemsQuery = usePriceListItems(priceList.id, {
    search: search || undefined,
    categoryId: categoryId || undefined,
    brandId: brandId || undefined,
    hasPrice: hasPrice === '' ? undefined : hasPrice === 'true',
    page,
    pageSize: PAGE_SIZE,
  } satisfies Partial<PriceListItemsQuery>);

  const items = itemsQuery.data?.items ?? [];
  const pagination = itemsQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const pendingCount = Object.keys(pending).length;
  const isFixed = priceList.pricingMode === 'FIXED';

  function setPendingPrice(variantId: string, value: string) {
    setPending((prev) => ({ ...prev, [variantId]: value }));
  }

  function discardChanges() {
    setPending({});
    setSaved(false);
  }

  async function handleSaveChanges() {
    setError(undefined);
    setSaved(false);
    const lines = Object.entries(pending).filter(([, price]) => price.trim() !== '');
    if (lines.length === 0) return;
    try {
      await setPrices.mutateAsync({
        priceListId: priceList.id,
        input: {
          items: lines.map(([productVariantId, price]) => ({ productVariantId, price })),
        },
      });
      setPending({});
      setSaved(true);
    } catch (err) {
      setError(pricingErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!isFixed && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
          Esta lista se calcula desde <span className="font-medium">{priceList.basePriceListName}</span>. Los
          precios que ves a continuación son calculados y no se pueden editar directamente — editá la lista
          base o la regla de derivación.
        </div>
      )}

      {isFixed && canBulkUpdate && (
        <div className="flex justify-end">
          <Link
            href={`/listas-de-precios/${priceList.id}/actualizacion-masiva`}
            className={buttonVariants({ variant: 'outline' })}
          >
            <Plus className="size-4" />
            Actualización masiva
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder="Buscar por nombre, código, SKU…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-sm"
          aria-label="Buscar productos"
        />
        <Select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          className="max-w-48"
          aria-label="Categoría"
        >
          <option value="">Todas las categorías</option>
          {categoriesQuery.data?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={brandId}
          onChange={(e) => {
            setBrandId(e.target.value);
            setPage(1);
          }}
          className="max-w-44"
          aria-label="Marca"
        >
          <option value="">Todas las marcas</option>
          {brandsQuery.data?.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select
          value={hasPrice}
          onChange={(e) => {
            setHasPrice(e.target.value);
            setPage(1);
          }}
          className="max-w-40"
          aria-label="Con precio"
        >
          <option value="">Con y sin precio</option>
          <option value="true">Solo con precio</option>
          <option value="false">Solo sin precio</option>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Categoría</th>
              <th className="px-4 py-2 text-right">{isFixed ? 'Precio actual' : 'Precio calculado'}</th>
              <th className="px-4 py-2">Vigente desde</th>
              {isFixed && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <PriceRow
                key={item.variantId}
                priceListId={priceList.id}
                item={item}
                currencyCode={priceList.currencyCode}
                editable={isFixed && canUpdatePrices}
                showHistoryToggle={isFixed}
                historyExpanded={expanded.has(item.variantId)}
                onToggleHistory={() => toggleExpanded(item.variantId)}
                pendingValue={pending[item.variantId]}
                onChange={(value) => setPendingPrice(item.variantId, value)}
              />
            ))}
            {!itemsQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={isFixed ? 7 : 6} className="px-4 py-10 text-center text-muted-foreground">
                  No encontramos productos con esos criterios.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {totalPages} — {pagination.total} producto{pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-2.5 py-1 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-2.5 py-1 disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      {isFixed && canUpdatePrices && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-3 shadow-sm">
          <div className="text-sm">
            {pendingCount > 0 ? (
              <span className="font-medium text-amber-600">
                {pendingCount} cambio{pendingCount === 1 ? '' : 's'} sin guardar
              </span>
            ) : (
              <span className="text-muted-foreground">Sin cambios pendientes</span>
            )}
            {saved && pendingCount === 0 && <span className="ml-2 text-emerald-600">Cambios guardados.</span>}
            {error && <span className="ml-2 text-destructive">{error}</span>}
          </div>
          <div className="flex gap-2">
            {pendingCount > 0 && (
              <Button type="button" variant="outline" onClick={discardChanges}>
                Descartar
              </Button>
            )}
            <Button type="button" onClick={handleSaveChanges} disabled={pendingCount === 0 || setPrices.isPending}>
              {setPrices.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceRow({
  priceListId,
  item,
  currencyCode,
  editable,
  showHistoryToggle,
  historyExpanded,
  onToggleHistory,
  pendingValue,
  onChange,
}: {
  priceListId: string;
  item: PriceListItemRowDto;
  currencyCode: string;
  editable: boolean;
  showHistoryToggle: boolean;
  historyExpanded: boolean;
  onToggleHistory: () => void;
  pendingValue: string | undefined;
  onChange: (value: string) => void;
}) {
  const isDirty = pendingValue !== undefined;
  const displayValue = pendingValue ?? item.price ?? '';

  return (
    <>
      <tr className={`border-t border-border ${isDirty ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{item.productCode}</td>
        <td className="px-4 py-2 font-medium">
          <Link href={`/productos/${item.productId}`} className="underline-offset-4 hover:underline">
            {item.productName}
          </Link>
          {item.variantName && <p className="text-xs text-muted-foreground">{item.variantName}</p>}
        </td>
        <td className="px-4 py-2 whitespace-nowrap">{item.sku ?? '—'}</td>
        <td className="px-4 py-2 whitespace-nowrap">{item.categoryName ?? '—'}</td>
        <td className="px-4 py-2 text-right">
          {editable ? (
            <input
              type="number"
              min="0"
              step="0.0001"
              value={displayValue}
              placeholder="Sin precio"
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="w-32 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          ) : item.price !== null ? (
            <span className="tabular-nums">{formatMoney(item.price, currencyCode)}</span>
          ) : (
            <span className="text-muted-foreground">Sin precio</span>
          )}
        </td>
        <td className="px-4 py-2 whitespace-nowrap">{item.effectiveFrom ?? '—'}</td>
        {showHistoryToggle && (
          <td className="px-4 py-2 text-right">
            <Button type="button" size="icon-sm" variant="ghost" onClick={onToggleHistory} title="Ver historial">
              <HistoryIcon className="size-4" />
            </Button>
          </td>
        )}
      </tr>
      {showHistoryToggle && historyExpanded && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={7} className="px-4 py-3">
            <PriceHistoryPanel priceListId={priceListId} variantId={item.variantId} currencyCode={currencyCode} />
          </td>
        </tr>
      )}
    </>
  );
}

function PriceHistoryPanel({
  priceListId,
  variantId,
  currencyCode,
}: {
  priceListId: string;
  variantId: string;
  currencyCode: string;
}) {
  const historyQuery = usePriceHistory(priceListId, variantId, {});
  const items = historyQuery.data?.items ?? [];

  if (historyQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando historial…</p>;
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay cambios de precio registrados.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((entry) => (
        <div key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">
            {entry.oldPrice ? formatMoney(entry.oldPrice, currencyCode) : 'Sin precio'} →{' '}
            {formatMoney(entry.newPrice, currencyCode)}
          </span>
          <span className="text-xs text-muted-foreground">
            vigente desde {entry.effectiveFrom} — {priceChangeTypeLabel(entry.changeType)}
            {entry.changedBy?.name ? ` — ${entry.changedBy.name}` : ''}
            {entry.reason ? ` — ${entry.reason}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function HistorialTab({ priceListId }: { priceListId: string }) {
  const historyQuery = usePriceListHistory(priceListId, {});
  const items = historyQuery.data?.items ?? [];

  if (historyQuery.isLoading) {
    return null;
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay eventos registrados para esta lista.</p>;
  }
  return (
    <div className="rounded-xl border border-border px-4">
      {items.map((item) => (
        <PriceListHistoryItem key={item.id} item={item} />
      ))}
    </div>
  );
}
