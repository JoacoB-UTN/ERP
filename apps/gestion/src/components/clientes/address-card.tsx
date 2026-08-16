'use client';

import { X } from 'lucide-react';
import { CustomerAddressType, customerAddressTypeLabel, ARGENTINA_PROVINCES, type CustomerAddressInput } from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export function AddressCard({
  value,
  onChange,
  onRemove,
  disabled,
}: {
  value: CustomerAddressInput;
  onChange: (next: CustomerAddressInput) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  function set<K extends keyof CustomerAddressInput>(key: K, val: CustomerAddressInput[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <Select
          value={value.type}
          onChange={(e) => set('type', e.target.value as CustomerAddressInput['type'])}
          className="max-w-48"
          disabled={disabled}
          aria-label="Tipo de domicilio"
        >
          {Object.values(CustomerAddressType).map((type) => (
            <option key={type} value={type}>
              {customerAddressTypeLabel(type)}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={value.isDefault}
              onChange={(e) => set('isDefault', e.target.checked)}
              disabled={disabled}
            />
            Predeterminado
          </label>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} disabled={disabled}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>Calle</Label>
          <Input value={value.street} onChange={(e) => set('street', e.target.value)} disabled={disabled} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Número</Label>
          <Input value={value.number ?? ''} onChange={(e) => set('number', e.target.value)} disabled={disabled} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label>Localidad</Label>
          <Input value={value.city} onChange={(e) => set('city', e.target.value)} disabled={disabled} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Provincia</Label>
          <Select
            value={value.province}
            onChange={(e) => set('province', e.target.value)}
            disabled={disabled}
          >
            <option value="">Elegir…</option>
            {ARGENTINA_PROVINCES.map((province) => (
              <option key={province} value={province}>
                {province}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Código postal</Label>
          <Input
            value={value.postalCode}
            onChange={(e) => set('postalCode', e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
