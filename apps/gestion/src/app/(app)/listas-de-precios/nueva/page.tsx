'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PricingMode, AdjustmentType, pricingModeLabel, adjustmentTypeLabel } from '@erp/shared';
import { usePermissions, useCurrencies, usePriceLists, useCreatePriceList } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { Unauthorized } from '@/components/layout/unauthorized';
import { pricingErrorMessage } from '@/components/pricing/pricing-errors';

const PRICING_MODES = Object.values(PricingMode);
const ADJUSTMENT_TYPES = Object.values(AdjustmentType);

export default function NuevaListaDePreciosPage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const currenciesQuery = useCurrencies();
  const priceListsQuery = usePriceLists();
  const createPriceList = useCreatePriceList();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [includesTax, setIncludesTax] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [pricingMode, setPricingMode] = useState<string>(PricingMode.FIXED);
  const [basePriceListId, setBasePriceListId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<string>(AdjustmentType.PERCENTAGE_DECREASE);
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  // Only lists sharing the chosen currency can be a valid base (see docs/pricing.md — PRICE_LIST_CURRENCY_MISMATCH).
  const eligibleBaseLists = useMemo(
    () => (priceListsQuery.data?.priceLists ?? []).filter((pl) => pl.active && pl.currencyId === currencyId),
    [priceListsQuery.data, currencyId],
  );

  if (permissionsLoading) {
    return null;
  }
  if (!can('pricing.lists.create')) {
    return <Unauthorized />;
  }

  const isDerived = pricingMode === 'DERIVED';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      const result = await createPriceList.mutateAsync({
        code,
        name,
        description: description || undefined,
        currencyId,
        includesTax,
        pricingMode: pricingMode as 'FIXED' | 'DERIVED',
        basePriceListId: isDerived ? basePriceListId : undefined,
        adjustmentType: isDerived ? (adjustmentType as (typeof ADJUSTMENT_TYPES)[number]) : undefined,
        adjustmentValue: isDerived ? adjustmentValue : undefined,
        isDefault,
      });
      router.push(`/listas-de-precios/${result.priceList.id}`);
    } catch (err) {
      setError(pricingErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6" noValidate>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nueva lista de precios</h1>
          <p className="text-sm text-muted-foreground">
            Una lista fija tiene precios cargados manualmente por producto. Una lista derivada calcula sus
            precios a partir de otra lista con un ajuste porcentual o fijo — nunca duplica precios.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Código</Label>
            <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={30} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Descripción (opcional)</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currency">Moneda</Label>
            <Select
              id="currency"
              value={currencyId}
              onChange={(e) => {
                setCurrencyId(e.target.value);
                setBasePriceListId('');
              }}
              required
            >
              <option value="">Elegí una moneda</option>
              {currenciesQuery.data?.currencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pricingMode">Tipo</Label>
            <Select
              id="pricingMode"
              value={pricingMode}
              onChange={(e) => {
                setPricingMode(e.target.value);
                setBasePriceListId('');
              }}
            >
              {PRICING_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {pricingModeLabel(mode)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {isDerived && (
          <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <p className="text-sm font-medium">Regla de derivación</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="basePriceList">Lista base</Label>
                <Select
                  id="basePriceList"
                  value={basePriceListId}
                  onChange={(e) => setBasePriceListId(e.target.value)}
                  required={isDerived}
                  disabled={!currencyId}
                >
                  <option value="">{currencyId ? 'Elegí una lista base' : 'Elegí primero una moneda'}</option>
                  {eligibleBaseLists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adjustmentType">Tipo de ajuste</Label>
                <Select
                  id="adjustmentType"
                  value={adjustmentType}
                  onChange={(e) => setAdjustmentType(e.target.value)}
                >
                  {ADJUSTMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {adjustmentTypeLabel(type)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label htmlFor="adjustmentValue">Valor del ajuste</Label>
              <Input
                id="adjustmentValue"
                type="number"
                min="0"
                step="0.000001"
                value={adjustmentValue}
                onChange={(e) => setAdjustmentValue(e.target.value)}
                required={isDerived}
              />
              <p className="text-xs text-muted-foreground">
                {adjustmentType.startsWith('PERCENTAGE') ? 'Puntos porcentuales, sin signo.' : 'Monto fijo, sin signo.'}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includesTax} onChange={(e) => setIncludesTax(e.target.checked)} />
            Los precios de esta lista incluyen impuestos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Marcar como lista predeterminada de la empresa
          </label>
        </div>

        <FieldError message={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={createPriceList.isPending}>
            {createPriceList.isPending ? 'Creando…' : 'Crear lista'}
          </Button>
        </div>
      </form>
    </div>
  );
}
