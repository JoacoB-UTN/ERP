'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { formatCuit, customerTaxConditionLabel } from '@erp/shared';
import type { CustomerLookupItem } from '@erp/shared';
import { useCustomerLookup } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface CustomerPickerSelection {
  customerId: string;
  displayName: string;
  code: string;
  taxId: string | null;
  taxCondition: string | null;
}

function toSelection(item: CustomerLookupItem): CustomerPickerSelection {
  return {
    customerId: item.id,
    displayName: item.displayName,
    code: item.code,
    taxId: item.taxId,
    taxCondition: item.taxCondition,
  };
}

/**
 * Fast customer search for the sale workspace — `GET /customers/lookup`
 * (ACTIVE only, see docs/customers.md) via `useCustomerLookup`. Selecting
 * a customer collapses the search into a compact summary card, never a
 * full customer administration form (that's Gestión's job).
 */
export function CustomerPicker({
  value,
  onSelect,
  onClear,
  autoFocus,
}: {
  value: CustomerPickerSelection | null;
  onSelect: (selection: CustomerPickerSelection) => void;
  onClear: () => void;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  const lookupQuery = useCustomerLookup({ search: term.trim() || undefined, limit: 8 }, { enabled: term.trim().length > 0 });
  const items = lookupQuery.data?.items ?? [];

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {value.code}
            {value.taxId ? ` · ${formatCuit(value.taxId)}` : ''}
            {value.taxCondition ? ` · ${customerTaxConditionLabel(value.taxCondition)}` : ''}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Cambiar cliente" onClick={onClear}>
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        autoFocus={autoFocus}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            e.currentTarget.blur();
          } else if (e.key === 'Enter' && items.length === 1) {
            e.preventDefault();
            onSelect(toSelection(items[0]));
            setTerm('');
            setOpen(false);
          }
        }}
        placeholder="Buscar cliente por código, nombre o CUIT/DNI…"
        aria-label="Buscar cliente"
      />
      {open && term.trim() && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover shadow-md">
          {items.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {lookupQuery.isLoading ? 'Buscando…' : 'Sin resultados.'}
            </p>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(toSelection(item));
                setTerm('');
                setOpen(false);
              }}
            >
              <span className="font-medium">{item.displayName}</span>
              <span className="text-xs text-muted-foreground">
                {item.code}
                {item.taxId ? ` · ${formatCuit(item.taxId)}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
