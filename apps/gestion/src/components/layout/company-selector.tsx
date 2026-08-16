'use client';

import { ChevronDown } from 'lucide-react';
import { useActiveCompany } from '@/lib/auth-client';

/**
 * Compact company switcher for the top bar. Per CLAUDE.md's UX principle
 * ("ask only when there's actually a decision to make"): with one
 * accessible company it renders as a plain label, no dropdown chrome; with
 * several, a native <select> (no new UI dependency, fully keyboard/
 * accessible by default) — deliberately not a heavier custom menu, this is
 * meant to be fast, not a settings screen.
 */
export function CompanySelector() {
  const { isLoading, companies, activeCompanyId, activeCompany, setActiveCompany } = useActiveCompany();

  if (isLoading || companies.length === 0) {
    return null;
  }

  if (companies.length === 1) {
    return (
      <span className="text-sm text-muted-foreground">
        {activeCompany?.tradeName ?? activeCompany?.legalName}
      </span>
    );
  }

  return (
    <div className="relative inline-flex items-center">
      <select
        aria-label="Empresa activa"
        value={activeCompanyId ?? ''}
        onChange={(e) => setActiveCompany(e.target.value || null)}
        className="appearance-none rounded-md border border-border bg-background py-1 pl-2 pr-7 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {!activeCompanyId && (
          <option value="" disabled>
            Elegir empresa…
          </option>
        )}
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.tradeName ?? c.legalName}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
    </div>
  );
}
