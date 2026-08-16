'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/** Lightweight secondary nav for the Stock section — see docs/inventory.md. Each link is gated by its own permission since Stock's permissions are more granular than Productos' (e.g. Ventas sees Existencias only). */
export function StockSubNav() {
  const pathname = usePathname();
  const { can, isLoading } = usePermissions();

  const links = [
    { href: '/stock', label: 'Existencias', visible: !isLoading && can('inventory.stock.read') },
    { href: '/stock/movimientos', label: 'Movimientos', visible: !isLoading && can('inventory.movements.read') },
    { href: '/stock/ajustes', label: 'Ajustes', visible: !isLoading && can('inventory.adjustments.read') },
    { href: '/stock/depositos', label: 'Depósitos', visible: !isLoading && can('inventory.warehouses.read') },
  ].filter((link) => link.visible);

  return (
    <div className="flex gap-1 border-b border-border">
      {links.map((link) => {
        const active = link.href === '/stock' ? pathname === '/stock' : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'px-3 py-2 text-sm font-medium',
              active ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
