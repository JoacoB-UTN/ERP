'use client';

import { useState } from 'react';
import { useSuppliers } from '@/lib/auth-client';

export interface SupplierPickerSelection {
  supplierId: string;
  displayName: string;
  code: string;
}

/**
 * Search-as-you-type supplier picker for Purchase Order / Goods Receipt
 * forms — mirrors CustomerPicker's shape (see
 * components/sales/customer-picker.tsx). Only ACTIVE suppliers are
 * offered; the backend independently rejects an inactive supplier
 * regardless of what this shows (see docs/purchases.md).
 */
export function SupplierPicker({
  value,
  onSelect,
}: {
  value: SupplierPickerSelection | null;
  onSelect: (selection: SupplierPickerSelection) => void;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  const suppliersQuery = useSuppliers({
    search: term.trim() || undefined,
    status: 'ACTIVE',
    pageSize: 8,
  });
  const items = term.trim().length > 0 ? (suppliersQuery.data?.items ?? []) : [];

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
        placeholder="Buscar proveedor por nombre o código…"
        className="h-(--control-height) w-full min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      {open && term.trim() && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
          {items.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {suppliersQuery.isLoading ? 'Buscando…' : 'Sin resultados.'}
            </p>
          )}
          {items.map((s) => (
            <button
              key={s.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect({ supplierId: s.id, displayName: s.displayName, code: s.code });
                setTerm('');
                setOpen(false);
              }}
            >
              <span className="font-medium">{s.displayName}</span>
              <span className="text-xs text-muted-foreground">{s.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
