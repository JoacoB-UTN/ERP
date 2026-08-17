'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LogOut, ReceiptText } from 'lucide-react';
import { useLogout, useActiveCompany, useActiveBranch } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CompanySelector } from './company-selector';
import { BranchSelector } from './branch-selector';
import { WarehouseSelector } from './warehouse-selector';
import { PriceListSelector } from './price-list-selector';

/**
 * Single top bar, no sidebar — Facturación is a fast, low-navigation
 * operational tool, not a backoffice with deep module trees. Ventas and
 * POS are both real modes now (see docs/facturacion.md and docs/pos.md) —
 * POS is a specialized checkout mode inside Facturación, not a separate
 * app. Company (legally/financially significant here) and branch are
 * shown right next to the wordmark so they're never ambiguous — see
 * CLAUDE.md.
 */
export function Topbar({ userLabel, userEmail }: { userLabel: string; userEmail: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const logout = useLogout();
  const { activeCompanyId } = useActiveCompany();
  const { activeBranchId } = useActiveBranch(activeCompanyId);

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  return (
    <header className="z-40 shrink-0 border-b border-border bg-card">
      <div className="mx-auto grid min-h-14 w-full max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:py-1.5 2xl:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ReceiptText className="size-4" />
            </span>
            <span className="hidden sm:inline">Facturación</span>
          </Link>
          <nav
            aria-label="Modos de Facturación"
            className="flex items-center gap-1 text-sm text-muted-foreground"
          >
            <Link
              href="/ventas"
              aria-current={pathname.startsWith('/ventas') ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center rounded-md px-3 font-medium transition-colors',
                pathname.startsWith('/ventas')
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted hover:text-foreground',
              )}
            >
              Venta
            </Link>
            <Link
              href="/pos"
              aria-current={pathname.startsWith('/pos') ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center rounded-md px-3 font-medium transition-colors',
                pathname.startsWith('/pos')
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted hover:text-foreground',
              )}
            >
              POS
            </Link>
          </nav>
        </div>

        <div
          className="order-3 col-span-2 mt-2 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-2 xl:order-none xl:col-span-1 xl:mt-0 xl:justify-center xl:border-t-0 xl:pt-0"
          aria-label="Contexto operativo"
        >
          <CompanySelector />
          <BranchSelector companyId={activeCompanyId} />
          <WarehouseSelector branchId={activeBranchId} />
          <PriceListSelector />
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
          <div className="hidden min-w-0 text-right leading-tight sm:block">
            <p className="text-sm font-medium">{userLabel}</p>
            <p className="max-w-48 truncate text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cerrar sesión"
            onClick={handleLogout}
            disabled={logout.isPending}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
