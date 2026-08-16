'use client';

import { ChevronDown } from 'lucide-react';
import { useActiveCompany } from '@/lib/auth-client';

/**
 * The active company must be very clear in Facturación — future sales
 * legally/financially belong to it — but the control itself stays compact
 * and operational, not a settings screen. See CLAUDE.md.
 */
export function CompanySelector() {
  const { isLoading, companies, activeCompanyId, activeCompany, setActiveCompany } = useActiveCompany();

  if (isLoading || companies.length === 0) {
    return null;
  }

  if (companies.length === 1) {
    return (
      <span className="text-sm font-medium">{activeCompany?.tradeName ?? activeCompany?.legalName}</span>
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
