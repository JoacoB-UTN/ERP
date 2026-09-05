'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
} from 'lucide-react';
import { usePermissions } from '@/lib/auth-client';
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

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const Icon = item.icon;
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/75 hover:bg-muted hover:text-sidebar-foreground',
      )}
    >
      <Icon className={cn('size-3.5', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
      <span>{item.label}</span>
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
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

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-2.5 py-3">
        {sections.map((section, index) => {
          const items = section.items.filter((item) => item.visible);
          if (items.length === 0) return null;

          return (
            <div key={section.label ?? 'inicio'} className={cn(index > 0 && 'mt-3.5')}>
              {section.label && (
                <p className="mb-1 px-2.5 text-[0.6875rem] font-semibold text-muted-foreground/80">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
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
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <SidebarContent />
      </aside>
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
