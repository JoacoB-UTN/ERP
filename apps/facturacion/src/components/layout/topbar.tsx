'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 md:px-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Facturación
        </Link>
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link
            href="/ventas"
            className={cn(
              'rounded-md px-2.5 py-1 font-medium',
              pathname.startsWith('/ventas') ? 'bg-muted text-foreground' : 'hover:text-foreground',
            )}
          >
            Ventas
          </Link>
          <Link
            href="/pos"
            className={cn(
              'rounded-md px-2.5 py-1 font-medium',
              pathname.startsWith('/pos') ? 'bg-muted text-foreground' : 'hover:text-foreground',
            )}
          >
            POS
          </Link>
        </nav>
        <span className="h-5 w-px bg-border" />
        <CompanySelector />
        <BranchSelector companyId={activeCompanyId} />
        <WarehouseSelector branchId={activeBranchId} />
        <PriceListSelector />
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right leading-tight">
          <p className="text-sm font-medium">{userLabel}</p>
          <p className="text-xs text-muted-foreground">{userEmail}</p>
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
    </header>
  );
}
