'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Contact,
  FileClock,
  History,
  Home,
  Package,
  PackageCheck,
  PackageSearch,
  PanelsTopLeft,
  DatabaseBackup,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  Truck,
  Users,
  Warehouse,
  X,
  LogOut,
  PanelLeft,
  ChevronRight,
} from 'lucide-react';
import { usePermissions, useLogout } from '@/lib/auth-client';
import { LogoMark, LogoMarkCompact } from '@/components/brand/logo-mark';
import { useSidebarCollapsed } from './sidebar-state';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  visible: boolean;
  exact?: boolean;
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      // The label is the accessible name when visible; collapsed, the rail
      // shows icons only, so the name has to come from somewhere else or the
      // link is unreadable to a screen reader. `title` also gives sighted users
      // the hover tooltip the rail depends on.
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'group flex h-9 items-center rounded-md text-[0.8125rem] font-medium transition-colors',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/75 hover:bg-muted hover:text-sidebar-foreground',
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          active ? 'text-sidebar-accent-foreground' : 'text-muted-foreground group-hover:text-foreground',
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function SidebarContent({
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const { can, isLoading } = usePermissions();
  const allowed = (permission: string) => !isLoading && can(permission);

  const sections: { label?: string; items: NavItem[] }[] = [
    {
      items: [{ href: '/', label: 'Inicio', icon: Home, visible: true, exact: true }],
    },
    {
      label: 'Operación',
      items: [
        { href: '/ventas', label: 'Ventas', icon: ShoppingCart, visible: allowed('sales.documents.read') },
      ],
    },
    {
      label: 'Maestros',
      items: [
        { href: '/clientes', label: 'Clientes', icon: Contact, visible: allowed('customers.read') },
        { href: '/productos', label: 'Productos', icon: Package, visible: allowed('products.read') },
      ],
    },
    {
      label: 'Compras',
      items: [
        {
          href: '/compras/proveedores',
          label: 'Proveedores',
          icon: Truck,
          visible: allowed('purchases.suppliers.read'),
        },
        {
          href: '/compras/ordenes',
          label: 'Órdenes de compra',
          icon: PackageSearch,
          visible: allowed('purchases.orders.read'),
        },
        {
          href: '/compras/recepciones',
          label: 'Recepciones',
          icon: PackageCheck,
          visible: allowed('purchases.goods-receipts.read'),
        },
      ],
    },
    {
      label: 'Inventario y precios',
      items: [
        { href: '/stock', label: 'Stock', icon: Warehouse, visible: allowed('inventory.stock.read'), exact: true },
        {
          href: '/stock/movimientos',
          label: 'Movimientos',
          icon: FileClock,
          visible: allowed('inventory.movements.read'),
        },
        {
          href: '/stock/ajustes',
          label: 'Ajustes',
          icon: SlidersHorizontal,
          visible: allowed('inventory.adjustments.read'),
        },
        {
          href: '/stock/depositos',
          label: 'Depósitos',
          icon: PanelsTopLeft,
          visible: allowed('inventory.warehouses.read'),
        },
        {
          href: '/listas-de-precios',
          label: 'Listas de precios',
          icon: Tag,
          visible: allowed('pricing.lists.read'),
        },
      ],
    },
    {
      label: 'Administración',
      items: [
        {
          href: '/administracion/usuarios',
          label: 'Usuarios',
          icon: Users,
          visible: allowed('administration.users.read'),
        },
        {
          href: '/administracion/roles',
          label: 'Roles',
          icon: ShieldCheck,
          visible: allowed('administration.roles.read'),
        },
        {
          href: '/administracion/auditoria',
          label: 'Auditoría',
          icon: History,
          visible: allowed('administration.audit.read'),
        },
        {
          href: '/administracion/backups',
          label: 'Backups',
          icon: DatabaseBackup,
          visible: allowed('system.backups.read'),
        },
      ],
    },
  ];

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  return (
    <div className="flex h-full flex-col">
      {/* The toggle is revealed by hovering the logo rather than sitting there
          permanently: collapsed, it is the only other thing in a 56px rail and
          competed with the mark for the same space. `focus-visible` keeps it
          reachable by keyboard — hidden by opacity, never removed from the
          tab order. */}
      <div
        className={cn(
          // Fixed 64px in both states, matching the band the session control
          // is centred in on the other side of the screen. Without that the
          // logo, the session control and the page's first line each sat at a
          // different height and the top edge read as ragged.
          'group/logo flex h-16 shrink-0 items-center',
          collapsed ? 'justify-center px-2' : 'justify-between gap-2 px-3',
        )}
      >
        {collapsed ? (
          <span className="relative flex size-8 items-center justify-center">
            <LogoMarkCompact className="transition-opacity group-hover/logo:opacity-0" />
            {onToggleCollapsed && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapsed}
                aria-label="Expandir panel"
                title="Expandir panel"
                aria-expanded={false}
                className="absolute inset-0 size-full opacity-0 transition-opacity group-hover/logo:opacity-100 focus-visible:opacity-100"
              >
                <ChevronRight className="size-4" />
              </Button>
            )}
          </span>
        ) : (
          <>
            <LogoMark className="w-[132px]" />
            {onToggleCollapsed && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapsed}
                aria-label="Contraer panel"
                title="Contraer panel"
                aria-expanded
                className="opacity-0 transition-opacity group-hover/logo:opacity-100 focus-visible:opacity-100"
              >
                <PanelLeft className="size-4" />
              </Button>
            )}
          </>
        )}
      </div>

      <nav
        aria-label="Navegación principal"
        className={cn('flex-1 overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-2.5')}
      >
        {sections.map((section, index) => {
          const items = section.items.filter((item) => item.visible);
          if (items.length === 0) return null;

          return (
            <div key={section.label ?? 'inicio'} className={cn(index > 0 && (collapsed ? 'mt-2' : 'mt-3.5'))}>
              {section.label &&
                (collapsed ? (
                  // Collapsed there is no room for the label, but the grouping
                  // still carries meaning — a rule keeps it without the words.
                  <div aria-hidden className="mx-2 mb-2 h-px bg-sidebar-border" />
                ) : (
                  <p className="mb-1 px-2.5 text-[0.6875rem] font-semibold text-muted-foreground/80">
                    {section.label}
                  </p>
                ))}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Anchored to the bottom, away from the navigation: signing out is not a
          destination, and putting it in the list invites mis-clicks by people
          aiming for the item above it. */}
      <div className={cn('shrink-0 pb-3', collapsed ? 'px-2' : 'px-2.5')}>
        <button
          type="button"
          onClick={handleLogout}
          disabled={logout.isPending}
          title={collapsed ? 'Cerrar sesión' : undefined}
          aria-label={collapsed ? 'Cerrar sesión' : undefined}
          className={cn(
            'flex h-9 w-full items-center rounded-md text-[0.8125rem] font-medium text-destructive transition-colors outline-none hover:bg-destructive-muted focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50',
            collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
          )}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && <span className="whitespace-nowrap">Cerrar sesión</span>}
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  mobileOpen,
  onMobileOpenChange,
}: {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}) {
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();

  return (
    <>
      <aside
        className={cn(
          // No width transition: with one, the computed width stayed pinned at
          // the old value while the contents had already switched to icons, so
          // collapsing left a 240px rail holding a 56px column. Verified by
          // removing the transition — the width snaps to 56px immediately.
          'sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar md:block',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>
      {/* The mobile sheet is always expanded: it is opened deliberately, covers
          the screen while open, and an icon rail inside a drawer would be the
          worst of both. */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent>
          <SheetTitle className="sr-only">Navegación de Gestión</SheetTitle>
          <SheetClose
            aria-label="Cerrar navegación"
            render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3 z-10" />}
          >
            <X className="size-4" />
          </SheetClose>
          <SidebarContent onNavigate={() => onMobileOpenChange(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
