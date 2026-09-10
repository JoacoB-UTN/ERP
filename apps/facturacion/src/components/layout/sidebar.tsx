'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronRight, Home, LogOut, PanelLeft, Receipt, ScanBarcode, X } from 'lucide-react';
import { useActiveBranch, useActiveCompany, useLogout, usePermissions } from '@/lib/auth-client';
import { LogoMark, LogoMarkCompact } from '@/components/brand/logo-mark';
import { useSidebarCollapsed } from './sidebar-state';
import { BranchSelector } from './branch-selector';
import { WarehouseSelector } from './warehouse-selector';
import { PriceListSelector } from './price-list-selector';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * Facturación's side panel, structurally the same as Gestión's so the two read
 * as one product — but with Facturación's own contents.
 *
 * It is NOT Gestión's navigation model: Inicio plus exactly two modes, Venta
 * and POS, because POS is a mode of Facturación rather than a separate app
 * (product-ui-principles.md). No nested tree, no grouped sections — this is a
 * fast operational tool, and the panel exists to hold the workspace's identity
 * and its operating context, not to become a backoffice menu.
 *
 * The operating context (branch, warehouse, price list) lives here now, where
 * the top bar used to carry it. It is hidden while the panel is collapsed —
 * a select cannot be shown in a 56px rail — which is the real cost of the icon
 * rail for this app, and the reason the panel defaults to expanded.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof Receipt;
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
      // Collapsed the rail shows icons only, so the accessible name has to come
      // from somewhere else or the link is unreadable to a screen reader.
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
          active
            ? 'text-sidebar-accent-foreground'
            : 'text-muted-foreground group-hover:text-foreground',
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
  const { activeCompanyId } = useActiveCompany();
  const { activeBranchId } = useActiveBranch(activeCompanyId);
  const allowed = (permission: string) => !isLoading && can(permission);

  const items: NavItem[] = [
    // Without this the panel has nothing highlighted on the home screen, which
    // reads as broken next to Gestión's — where Inicio is a real entry.
    { href: '/', label: 'Inicio', icon: Home, visible: true, exact: true },
    { href: '/ventas', label: 'Venta', icon: Receipt, visible: allowed('apps.facturacion.access') },
    { href: '/pos', label: 'POS', icon: ScanBarcode, visible: allowed('apps.facturacion.pos.access') },
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
        aria-label="Modos de Facturación"
        className={cn('shrink-0 pb-3', collapsed ? 'px-2' : 'px-2.5')}
      >
        <div className="space-y-0.5">
          {items
            .filter((item) => item.visible)
            .map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
        </div>
      </nav>

      {!collapsed && (
        <div
          aria-label="Contexto operativo"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t border-sidebar-border px-2.5 py-3"
        >
          <BranchSelector companyId={activeCompanyId} />
          <WarehouseSelector branchId={activeBranchId} />
          <PriceListSelector />
        </div>
      )}
      {collapsed && <div className="flex-1" />}

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
          // collapsing left a wide rail holding a narrow column.
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
          <SheetTitle className="sr-only">Navegación de Facturación</SheetTitle>
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
