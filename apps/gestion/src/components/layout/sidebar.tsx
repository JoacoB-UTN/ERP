'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  Home,
  Users,
  ShieldCheck,
  History,
  Contact,
  Package,
  Warehouse,
  Tag,
  ShoppingCart,
} from 'lucide-react';
import { usePermissions } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

/**
 * Permission-aware navigation (see CLAUDE.md — frontend visibility hides
 * what a user has no access to, it does not enforce it; the backend does
 * that independently). Only a small administration area exists for this
 * task — no fake menus for future ERP modules that don't exist yet.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { can, canAny, isLoading } = usePermissions();

  const canSeeCustomers = !isLoading && can('customers.read');
  const canSeeProducts = !isLoading && can('products.read');
  const canSeePriceLists = !isLoading && can('pricing.lists.read');
  const canSeeSales = !isLoading && can('sales.documents.read');
  const canSeeStock =
    !isLoading &&
    canAny([
      'inventory.stock.read',
      'inventory.movements.read',
      'inventory.adjustments.read',
      'inventory.warehouses.read',
    ]);
  const canSeeUsers = !isLoading && can('administration.users.read');
  const canSeeRoles = !isLoading && can('administration.roles.read');
  const canSeeAudit = !isLoading && can('administration.audit.read');
  const showAdministration = canSeeUsers || canSeeRoles || canSeeAudit;

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <Building2 className="size-5" />
        <span className="text-sm font-semibold tracking-tight">Gestión</span>
      </div>
      <nav className="flex-1 space-y-4 px-2 py-4">
        <div className="space-y-0.5">
          <NavLink item={{ href: '/', label: 'Inicio', icon: Home }} active={pathname === '/'} />
          {canSeeCustomers && (
            <NavLink
              item={{ href: '/clientes', label: 'Clientes', icon: Contact }}
              active={pathname.startsWith('/clientes')}
            />
          )}
          {canSeeProducts && (
            <NavLink
              item={{ href: '/productos', label: 'Productos', icon: Package }}
              active={pathname.startsWith('/productos')}
            />
          )}
          {canSeePriceLists && (
            <NavLink
              item={{ href: '/listas-de-precios', label: 'Listas de precios', icon: Tag }}
              active={pathname.startsWith('/listas-de-precios')}
            />
          )}
          {canSeeStock && (
            <NavLink
              item={{ href: '/stock', label: 'Stock', icon: Warehouse }}
              active={pathname.startsWith('/stock')}
            />
          )}
          {canSeeSales && (
            <NavLink
              item={{ href: '/ventas', label: 'Ventas', icon: ShoppingCart }}
              active={pathname.startsWith('/ventas')}
            />
          )}
        </div>

        {showAdministration && (
          <div className="space-y-0.5">
            <p className="px-2 text-xs font-medium text-muted-foreground">Administración</p>
            {canSeeUsers && (
              <NavLink
                item={{ href: '/administracion/usuarios', label: 'Usuarios', icon: Users }}
                active={pathname.startsWith('/administracion/usuarios')}
              />
            )}
            {canSeeRoles && (
              <NavLink
                item={{ href: '/administracion/roles', label: 'Roles', icon: ShieldCheck }}
                active={pathname.startsWith('/administracion/roles')}
              />
            )}
            {canSeeAudit && (
              <NavLink
                item={{ href: '/administracion/auditoria', label: 'Auditoría', icon: History }}
                active={pathname.startsWith('/administracion/auditoria')}
              />
            )}
          </div>
        )}
      </nav>
    </aside>
  );
}
