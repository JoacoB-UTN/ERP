'use client';

import Link from 'next/link';
import { Plus, Zap } from 'lucide-react';
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Facturación</h1>
          <p className="text-sm text-muted-foreground">Vendé rápido: cliente, producto, confirmar.</p>
        </div>
        {!isLoading && can('sales.documents.create') && (
          <div className="flex gap-2">
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
      </div>

      {!isLoading && can('sales.documents.read') && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Ventas recientes</h2>
            <Link href="/ventas" className="text-sm underline-offset-4 hover:underline">
              Ver todas
            </Link>
          </div>
          <RecentSalesList filters={{ pageSize: 6 }} emptyLabel="Todavía no hay ventas. Empezá con Nueva venta." />
        </div>
      )}
    </div>
  );
}
