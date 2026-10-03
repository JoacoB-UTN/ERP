'use client';
import type { ReactNode } from 'react';
import { useActiveCompany } from '@/lib/auth-client';

export default function TreasuryLayout({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useActiveCompany();
  if (!activeCompanyId) return <p>Seleccioná una empresa para trabajar en Tesorería.</p>;
  // Tear down queries, drafts, dialogs and pending completion handlers together.
  return <div key={activeCompanyId}>{children}</div>;
}
