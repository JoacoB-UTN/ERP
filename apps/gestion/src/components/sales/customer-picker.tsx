'use client';

import { useState } from 'react';
import { useCustomers } from '@/lib/auth-client';

export interface CustomerPickerSelection {
  customerId: string;
  displayName: string;
  code: string;
}

/**
 * Search-as-you-type customer picker for the new-sale form — mirrors
 * VariantPicker's shape (see components/stock/variant-picker.tsx). Only
 * ACTIVE customers are offered; SalesService independently rejects an
 * inactive customer regardless of what this shows (see docs/sales.md).
 */
export function CustomerPicker({
  value,
  onSelect,
}: {
  value: CustomerPickerSelection | null;
  onSelect: (selection: CustomerPickerSelection) => void;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  const customersQuery = useCustomers({
    search: term.trim() || undefined,
    status: 'ACTIVE',
    pageSize: 8,
  });
  const items = term.trim().length > 0 ? (customersQuery.data?.items ?? []) : [];

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? term : (value?.displayName ?? term)}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setTerm('');
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar cliente por nombre o código…"
        className="h-(--control-height) w-full min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      {open && term.trim() && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
          {items.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {customersQuery.isLoading ? 'Buscando…' : 'Sin resultados.'}
            </p>
          )}
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect({ customerId: c.id, displayName: c.displayName, code: c.code });
                setTerm('');
                setOpen(false);
              }}
            >
              <span className="font-medium">{c.displayName}</span>
              <span className="text-xs text-muted-foreground">{c.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
