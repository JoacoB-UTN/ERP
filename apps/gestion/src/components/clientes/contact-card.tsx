'use client';

import { X } from 'lucide-react';
import type { CustomerContactInput } from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function ContactCard({
  value,
  onChange,
  onRemove,
  disabled,
}: {
  value: CustomerContactInput;
  onChange: (next: CustomerContactInput) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  function set<K extends keyof CustomerContactInput>(key: K, val: CustomerContactInput[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={value.isPrimary}
            onChange={(e) => set('isPrimary', e.target.checked)}
            disabled={disabled}
          />
          Contacto principal
        </label>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} disabled={disabled}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Nombre</Label>
          <Input value={value.name} onChange={(e) => set('name', e.target.value)} disabled={disabled} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Cargo / Área</Label>
          <Input
            value={value.role ?? ''}
            onChange={(e) => set('role', e.target.value)}
            placeholder="Compras, Administración, Pagos…"
            disabled={disabled}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label>Email</Label>
          <Input
            type="email"
            value={value.email ?? ''}
            onChange={(e) => set('email', e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Teléfono</Label>
          <Input value={value.phone ?? ''} onChange={(e) => set('phone', e.target.value)} disabled={disabled} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Celular</Label>
          <Input
            value={value.mobile ?? ''}
            onChange={(e) => set('mobile', e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
