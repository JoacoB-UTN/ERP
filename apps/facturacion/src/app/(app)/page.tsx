'use client';

import Link from 'next/link';
import { ArrowRight, Plus, Zap } from 'lucide-react';
import { usePermissions } from '@/lib/auth-client';
import { RecentSalesList } from '@/components/ventas/recent-sales-list';
import { buttonVariants } from '@/components/ui/button';

/**
 * The Facturación home experience is built around a single operational
 * action, not a decorative dashboard — see docs/facturacion.md and
 * docs/product-ui-principles.md.
 */
export default function FacturacionHomePage() {
  const { can, isLoading } = usePermissions();

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6">
      <header>
        <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Operación de ventas
        </p>
        <div className="mt-1 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Facturación</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Iniciá una venta, continuá un borrador o revisá las últimas operaciones.
            </p>
          </div>
        </div>
      </header>

      {!isLoading && can('sales.documents.create') && (
        <section className="flex flex-col gap-4 border-y border-border bg-card/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Plus className="size-4" />
            </span>
            <div>
              <h2 className="font-semibold">Nueva operación</h2>
              <p className="text-xs text-muted-foreground">
                Venta normal con cliente, búsqueda y borrador recuperable.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/ventas/nueva" className={buttonVariants({ size: 'lg' })}>
              Nueva venta
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/pos" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              <Zap className="size-4" />
              POS
            </Link>
          </div>
        </section>
      )}

      {!isLoading && can('sales.documents.read') && (
        <section className="flex flex-col gap-3" aria-labelledby="recent-sales-title">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 id="recent-sales-title" className="text-base font-semibold">
                Operaciones recientes
              </h2>
              <p className="text-xs text-muted-foreground">Ventas confirmadas y borradores para continuar.</p>
            </div>
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
