'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/productos', label: 'Productos' },
  { href: '/productos/categorias', label: 'Categorías' },
  { href: '/productos/marcas', label: 'Marcas' },
  { href: '/productos/unidades', label: 'Unidades' },
];

/** Lightweight secondary nav for the Productos section — categories/brands/units are catalog configuration, not separate sidebar items (see docs/products.md). */
export function ProductosSubNav() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-border">
      {LINKS.map((link) => {
        const active = link.href === '/productos' ? pathname === '/productos' : pathname.startsWith(link.href);
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
