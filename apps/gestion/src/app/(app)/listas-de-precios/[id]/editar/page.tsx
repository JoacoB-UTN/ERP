'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AdjustmentType, adjustmentTypeLabel, type PriceListDto } from '@erp/shared';
import { usePermissions, usePriceList, usePriceLists, useUpdatePriceList } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { pricingErrorMessage } from '@/components/pricing/pricing-errors';

const ADJUSTMENT_TYPES = Object.values(AdjustmentType);

export default function EditarListaDePreciosPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const priceListQuery = usePriceList(id ?? null);
  const priceListsQuery = usePriceLists();

  if (permissionsLoading || priceListQuery.isLoading) {
    return null;
  }
  const priceList = priceListQuery.data?.priceList;
  if (!can('pricing.lists.update') || !priceList) {
    return <Unauthorized />;
  }

  return (
    <EditarListaForm
      key={priceList.id}
      priceList={priceList}
      allLists={priceListsQuery.data?.priceLists ?? []}
    />
  );
}

function EditarListaForm({ priceList, allLists }: { priceList: PriceListDto; allLists: PriceListDto[] }) {
  const updatePriceList = useUpdatePriceList();

  const [code, setCode] = useState(priceList.code);
  const [name, setName] = useState(priceList.name);
  const [description, setDescription] = useState(priceList.description ?? '');
  const [includesTax, setIncludesTax] = useState(priceList.includesTax);
  const [isDefault, setIsDefault] = useState(priceList.isDefault);
  const [basePriceListId, setBasePriceListId] = useState(priceList.basePriceListId ?? '');
  const [adjustmentType, setAdjustmentType] = useState<string>(
    priceList.adjustmentType ?? AdjustmentType.PERCENTAGE_DECREASE,
  );
  const [adjustmentValue, setAdjustmentValue] = useState(priceList.adjustmentValue ?? '');
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const isDerived = priceList.pricingMode === 'DERIVED';

  // Same currency + not itself + not already-inactive — see docs/pricing.md's cycle/currency validation (enforced again server-side).
  const eligibleBaseLists = useMemo(
    () => allLists.filter((pl) => pl.active && pl.currencyId === priceList.currencyId && pl.id !== priceList.id),
    [allLists, priceList.currencyId, priceList.id],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    try {
      await updatePriceList.mutateAsync({
        id: priceList.id,
        input: {
          code,
          name,
          description: description || null,
          includesTax,
          isDefault,
          ...(isDerived
            ? {
                basePriceListId,
                adjustmentType: adjustmentType as (typeof ADJUSTMENT_TYPES)[number],
                adjustmentValue,
              }
            : {}),
        },
      });
      setSaved(true);
    } catch (err) {
      setError(pricingErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/listas-de-precios/${priceList.id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver a {priceList.name}
      </Link>

      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6" noValidate>
        <PageHeader
          title={`Editar ${priceList.name}`}
          description={`Moneda ${priceList.currencyCode} y tipo ${isDerived ? 'Derivada' : 'Fija'} no se pueden cambiar.`}
        />

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

        {isDerived && (
          <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <p className="text-sm font-medium">Regla de derivación</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="basePriceList">Lista base</Label>
                <Select id="basePriceList" value={basePriceListId} onChange={(e) => setBasePriceListId(e.target.value)}>
                  {eligibleBaseLists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adjustmentType">Tipo de ajuste</Label>
                <Select id="adjustmentType" value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value)}>
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
                required
              />
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
        {saved && !error && <p className="text-sm text-emerald-600">Cambios guardados.</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={updatePriceList.isPending}>
            {updatePriceList.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </div>
  );
}
