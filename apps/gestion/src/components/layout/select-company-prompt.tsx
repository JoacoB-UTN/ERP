'use client';

import type { CompanySummary } from '@erp/shared';
import { useActiveCompany } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

/**
 * Shown in place of the (empty, foundation-only) dashboard when the user
 * has more than one accessible company and none is active yet — a fast,
 * one-click alternative to hunting for the header selector. See CLAUDE.md
 * ("ask only when there's actually a decision to make").
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
