'use client';

import { X } from 'lucide-react';
import { ProductCodeType, productCodeTypeLabel, type ProductCodeInput } from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

/** One row of the repeatable "Códigos" list — barcode or any other alternate code (see docs/products.md). */
export function CodeCard({
  value,
  onChange,
  onRemove,
  disabled,
}: {
  value: ProductCodeInput;
  onChange: (next: ProductCodeInput) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  function set<K extends keyof ProductCodeInput>(key: K, val: ProductCodeInput[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value.type}
        onChange={(e) => set('type', e.target.value as ProductCodeInput['type'])}
        className="max-w-40 shrink-0"
        disabled={disabled}
        aria-label="Tipo de código"
      >
        {Object.values(ProductCodeType).map((type) => (
          <option key={type} value={type}>
            {productCodeTypeLabel(type)}
          </option>
        ))}
      </Select>
      <Input
        value={value.code}
        onChange={(e) => set('code', e.target.value)}
        placeholder="Código"
        disabled={disabled}
        className="flex-1"
        aria-label="Código"
      />
      <Input
        value={value.description ?? ''}
        onChange={(e) => set('description', e.target.value)}
        placeholder="Descripción (opcional)"
        disabled={disabled}
        className="flex-1"
        aria-label="Descripción del código"
      />
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} disabled={disabled}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
