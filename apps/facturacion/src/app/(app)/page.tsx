'use client';

import Link from 'next/link';
import { Plus, Zap } from 'lucide-react';
import { usePermissions } from '@/lib/auth-client';
import { RecentSalesList } from '@/components/ventas/recent-sales-list';
import { buttonVariants } from '@/components/ui/button';

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
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-4">
      <h1 className="text-lg leading-6 font-semibold tracking-tight">Facturación</h1>

      {!isLoading && can('sales.documents.create') && (
        <div className="flex flex-wrap gap-2">
          <Link href="/ventas/nueva" className={buttonVariants({ size: 'lg' })}>
            <Plus className="size-4" />
            Nueva venta
          </Link>
          <Link href="/pos" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
            <Zap className="size-4" />
            POS
          </Link>
        </div>
      )}

      {!isLoading && can('sales.documents.read') && (
        <section className="flex flex-col gap-2.5" aria-labelledby="recent-sales-title">
          <div className="flex items-center justify-between gap-4">
            <h2 id="recent-sales-title" className="text-sm font-semibold">
              Operaciones recientes
            </h2>
            <Link
              href="/ventas"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
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
