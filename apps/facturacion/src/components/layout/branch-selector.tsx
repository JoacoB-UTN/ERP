'use client';

import { ChevronDown } from 'lucide-react';
import { useActiveBranch } from '@/lib/auth-client';

/**
 * Facturación is branch-oriented (future POS/cash-register/invoice
 * numbering all need one) — see CLAUDE.md. One active branch auto-selects
 * silently; more than one gets a compact selector, same pattern as
 * CompanySelector. Not shown at all until a company is active, since
 * branches belong to a company.
 */
export function BranchSelector({ companyId }: { companyId: string | null }) {
  const { isLoading, branches, activeBranchId, activeBranch, setActiveBranch } = useActiveBranch(companyId);

  if (!companyId || isLoading || branches.length === 0) {
    return null;
  }

  if (branches.length === 1) {
    return <span className="text-sm text-muted-foreground">{activeBranch?.name}</span>;
  }

  return (
    <div className="relative inline-flex items-center">
      <select
        aria-label="Sucursal activa"
        value={activeBranchId ?? ''}
        onChange={(e) => setActiveBranch(e.target.value || null)}
        className="appearance-none rounded-md border border-border bg-background py-1 pl-2 pr-7 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {!activeBranchId && (
          <option value="" disabled>
            Elegir sucursal…
          </option>
        )}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
    </div>
  );
}
