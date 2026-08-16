'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useLogout, useActiveCompany, useActiveBranch } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { CompanySelector } from './company-selector';
import { BranchSelector } from './branch-selector';
import { WarehouseSelector } from './warehouse-selector';
import { PriceListSelector } from './price-list-selector';

/**
 * Single top bar, no sidebar — Facturación is a fast, low-navigation
 * operational tool, not a backoffice with deep module trees. The mode
 * pills are non-functional placeholders for the future Facturación/POS
 * split (see docs/product-ui-principles.md). Company (legally/financially
 * significant here) and branch are shown right next to the wordmark so
 * they're never ambiguous — see CLAUDE.md.
 */
export function Topbar({ userLabel, userEmail }: { userLabel: string; userEmail: string }) {
  const router = useRouter();
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
        <span className="text-sm font-semibold tracking-tight">Facturación</span>
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <span className="rounded-md bg-muted px-2.5 py-1 font-medium text-foreground">Facturación</span>
          <span className="cursor-not-allowed rounded-md px-2.5 py-1 opacity-50">POS</span>
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
