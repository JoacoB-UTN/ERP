'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { SalesListQuery } from '@erp/shared';
import { usePermissions } from '@/lib/auth-client';
import { RecentSalesList } from '@/components/ventas/recent-sales-list';
import { Select } from '@/components/ui/select';
import { buttonVariants } from '@/components/ui/button';

/** Full recent-sales list — draft/confirmed/cancelled, filterable by estado. Not a reporting screen (see docs/facturacion.md). */
export default function VentasPage() {
  const { can, isLoading } = usePermissions();
  const [status, setStatus] = useState('');

  if (isLoading) return null;
  if (!can('sales.documents.read')) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para ver ventas.</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Operación</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ventas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Continuá borradores o consultá operaciones ya confirmadas.
          </p>
        </div>
        {can('sales.documents.create') && (
          <Link href="/ventas/nueva" className={buttonVariants({ size: 'lg' })}>
            <Plus className="size-4" />
            Nueva venta
          </Link>
        )}
      </header>

      <div className="flex items-center gap-3 border-y border-border bg-card/60 py-3">
        <span className="text-xs font-medium text-muted-foreground">Estado</span>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="max-w-48"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borradores</option>
          <option value="CONFIRMED">Confirmadas</option>
          <option value="CANCELLED">Canceladas</option>
        </Select>
      </div>

      <RecentSalesList
        filters={{ status: (status || undefined) as SalesListQuery['status'], pageSize: 50 }}
        emptyLabel={status ? 'No hay ventas con ese estado.' : 'Todavía no hay ventas registradas.'}
      />
    </div>
  );
}
