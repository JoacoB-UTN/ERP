'use client';

import { ChevronDown } from 'lucide-react';
import { useActiveCompany } from '@/lib/auth-client';
import { ContextField } from './context-field';

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
      <ContextField label="Empresa" className="min-w-32">
        <span className="max-w-44 truncate">{activeCompany?.tradeName ?? activeCompany?.legalName}</span>
      </ContextField>
    );
  }

  return (
    <ContextField label="Empresa" className="min-w-40">
      <div className="relative inline-flex min-w-0 items-center">
        <select
          aria-label="Empresa activa"
          value={activeCompanyId ?? ''}
          onChange={(e) => setActiveCompany(e.target.value || null)}
          className="h-7 max-w-48 appearance-none rounded-md border border-border bg-card py-0 pl-2 pr-7 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring"
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
        <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
      </div>
    </ContextField>
  );
}
