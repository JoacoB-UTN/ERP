'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { SalesListQuery } from '@erp/shared';
import { usePermissions } from '@/lib/auth-client';
import { RecentSalesList } from '@/components/ventas/recent-sales-list';
import { Select } from '@/components/ui/select';
import { buttonVariants } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';
import { Toolbar } from '@/components/ui/toolbar';

/** Full recent-sales list — draft/confirmed/cancelled, filterable by estado. Not a reporting screen (see docs/facturacion.md). */
export default function VentasPage() {
  const { can, isLoading } = usePermissions();
  const [status, setStatus] = useState('');

  if (isLoading) return null;
  if (!can('sales.documents.read')) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para ver ventas.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Same heading and toolbar shape as every Gestión list screen: no
          uppercase eyebrow, no explanatory subtitle, and filters in the page
          flow rather than a bordered band — see docs/desktop-ui-direction.md. */}
      <ListHeader title="Ventas" />

      <Toolbar
        actions={
          can('sales.documents.create') && (
            // h-8 on top of size="sm" because Facturación's control scale is
            // 4px taller than Gestión's for POS touch targets — its `sm` is
            // 36px. This list's filters already opt out of that scale the same
            // way (h-8), since it is a back-office list, not the counter; the
            // button has to opt out with them or it stands 4px proud of the
            // field beside it. The scale itself is left alone: raising it here
            // would reach the POS, which product-ui-principles.md says to
            // leave large on purpose.
            <Link href="/ventas/nueva" className={buttonVariants({ size: 'sm', className: 'h-8' })}>
              <Plus className="size-4" />
              Nueva venta
            </Link>
          )
        }
      >
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-8 max-w-48 py-1 text-sm"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borradores</option>
          <option value="CONFIRMED">Confirmadas</option>
          <option value="CANCELLED">Canceladas</option>
        </Select>
      </Toolbar>

      <RecentSalesList
        filters={{ status: (status || undefined) as SalesListQuery['status'], pageSize: 50 }}
        emptyLabel={status ? 'No hay ventas con ese estado.' : 'Todavía no hay ventas registradas.'}
      />
    </div>
  );
}
