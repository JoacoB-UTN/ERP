'use client';

import { Plus, X } from 'lucide-react';
import type { ProductVariantCreateInput, ProductCodeInput } from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { CodeCard } from './code-card';

function emptyCode(): ProductCodeInput {
  return { type: 'BARCODE', code: '' };
}

/**
 * One explicit variant in the create form (e.g. "Negro / M") — name, SKU,
 * a small repeatable key/value attribute list, and its own codes. See
 * docs/products.md — attributes stay a plain flat JSONB map, not a formal
 * attribute-definition engine.
 */
export function VariantCard({
  value,
  onChange,
  onRemove,
  disabled,
}: {
  value: ProductVariantCreateInput;
  onChange: (next: ProductVariantCreateInput) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const attributeEntries = Object.entries(value.attributes ?? {});

  function setAttributes(entries: [string, string][]) {
    const obj: Record<string, string> = {};
    for (const [k, v] of entries) obj[k] = v;
    onChange({ ...value, attributes: Object.keys(obj).length > 0 ? obj : undefined });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Nombre de la variante</Label>
            <Input
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="Negro / M"
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>SKU</Label>
            <Input
              value={value.sku ?? ''}
              onChange={(e) => onChange({ ...value, sku: e.target.value })}
              placeholder="REM-NEG-M"
              disabled={disabled}
            />
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} disabled={disabled}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Atributos</Label>
        {attributeEntries.map(([key, val], index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={key}
              onChange={(e) => {
                const next = [...attributeEntries];
                next[index] = [e.target.value, val];
                setAttributes(next);
              }}
              placeholder="Color"
              disabled={disabled}
              className="max-w-40"
              aria-label="Nombre del atributo"
            />
            <Input
              value={val}
              onChange={(e) => {
                const next = [...attributeEntries];
                next[index] = [key, e.target.value];
                setAttributes(next);
              }}
              placeholder="Negro"
              disabled={disabled}
              className="max-w-40"
              aria-label="Valor del atributo"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setAttributes(attributeEntries.filter((_, i) => i !== index))}
              disabled={disabled}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setAttributes([...attributeEntries, ['', '']])}
          disabled={disabled}
        >
          <Plus className="size-4" />
          Agregar atributo
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Códigos</Label>
        {value.codes.map((code, index) => (
          <CodeCard
            key={index}
            value={code}
            onChange={(next) =>
              onChange({ ...value, codes: value.codes.map((c, i) => (i === index ? next : c)) })
            }
            onRemove={() => onChange({ ...value, codes: value.codes.filter((_, i) => i !== index) })}
            disabled={disabled}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => onChange({ ...value, codes: [...value.codes, emptyCode()] })}
          disabled={disabled}
        >
          <Plus className="size-4" />
          Agregar código
        </Button>
      </div>
    </div>
  );
}
