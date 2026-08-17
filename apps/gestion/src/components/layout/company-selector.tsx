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
      <div className="min-w-0 leading-tight">
        <span className="block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          Empresa
        </span>
        <span className="block max-w-48 truncate text-sm font-semibold sm:max-w-72">
          {activeCompany?.tradeName ?? activeCompany?.legalName}
        </span>
      </div>
    );
  }

  return (
    <div className="relative inline-flex min-w-0 flex-col items-start leading-tight">
      <span className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Empresa</span>
      <select
        aria-label="Empresa activa"
        value={activeCompanyId ?? ''}
        onChange={(e) => setActiveCompany(e.target.value || null)}
        className="h-6 max-w-48 appearance-none border-0 bg-transparent py-0 pr-6 text-sm font-semibold focus:outline-none focus:ring-0 sm:max-w-72"
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
      <ChevronDown className="pointer-events-none absolute right-1 bottom-1 size-3.5 text-muted-foreground" />
    </div>
  );
}
