'use client';

import Link from 'next/link';
import { Plus, Zap } from 'lucide-react';
import { usePermissions } from '@/lib/auth-client';
import { RecentSalesList } from '@/components/ventas/recent-sales-list';
import { buttonVariants } from '@/components/ui/button';
import { ListHeader } from '@/components/ui/page-header';

/**
 * The Facturación home experience is built around a single operational
 * action, not a decorative dashboard — see docs/facturacion.md and
 * docs/product-ui-principles.md. Layout tightened per
 * docs/desktop-ui-direction.md: the previous version wrapped the primary
 * action in a card-band with a decorative icon badge and explanatory
 * copy — landing-page framing for what should be an immediate action.
 */
export default function FacturacionHomePage() {
  const { can, isLoading } = usePermissions();

  return (
    <div className="flex flex-col gap-2.5">
      <ListHeader title="Facturación" />

      {!isLoading && can('sales.documents.create') && (
        <div className="flex flex-wrap gap-2">
          <Link href="/ventas/nueva" className={buttonVariants()}>
            <Plus className="size-4" />
            Nueva venta
          </Link>
          <Link href="/pos" className={buttonVariants({ variant: 'outline' })}>
            <Zap className="size-4" />
            POS
          </Link>
        </div>
      )}

      {!isLoading && can('sales.documents.read') && (
        <section className="flex flex-col gap-2.5" aria-labelledby="recent-sales-title">
          <div className="flex items-center justify-between gap-4">
            <h2 id="recent-sales-title" className="text-base font-semibold text-foreground">
              Operaciones recientes
            </h2>
            <Link
              href="/ventas"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Ver todas
            </Link>
          </div>
          <RecentSalesList
            filters={{ pageSize: 6 }}
            emptyLabel="Todavía no hay ventas. Empezá con Nueva venta."
          />
        </section>
      )}
    </div>
  );
}
