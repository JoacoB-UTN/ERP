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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Ventas recientes</h1>
        {can('sales.documents.create') && (
          <Link href="/ventas/nueva" className={buttonVariants()}>
            <Plus className="size-4" />
            Nueva venta
          </Link>
        )}
      </div>

      <Select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="max-w-44"
        aria-label="Estado"
      >
        <option value="">Todos los estados</option>
        <option value="DRAFT">Borradores</option>
        <option value="CONFIRMED">Confirmadas</option>
        <option value="CANCELLED">Canceladas</option>
      </Select>

      <RecentSalesList
        filters={{ status: (status || undefined) as SalesListQuery['status'], pageSize: 50 }}
        emptyLabel="Todavía no hay ventas registradas."
      />
    </div>
  );
}
