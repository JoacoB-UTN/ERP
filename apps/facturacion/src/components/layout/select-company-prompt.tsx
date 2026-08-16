'use client';

import type { CompanySummary } from '@erp/shared';
import { useActiveCompany } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

/**
 * Fast, one-click company pick — shown instead of the (empty,
 * foundation-only) home when more than one company is accessible and none
 * is active yet. See CLAUDE.md ("ask only when there's actually a
 * decision to make").
 */
export function SelectCompanyPrompt({ companies }: { companies: CompanySummary[] }) {
  const { setActiveCompany } = useActiveCompany();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-medium">Elegí una empresa para continuar</p>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {companies.map((c) => (
          <Button
            key={c.id}
            type="button"
            variant="outline"
            className="justify-start"
            onClick={() => setActiveCompany(c.id)}
          >
            {c.tradeName ?? c.legalName}
          </Button>
        ))}
      </div>
    </div>
  );
}
