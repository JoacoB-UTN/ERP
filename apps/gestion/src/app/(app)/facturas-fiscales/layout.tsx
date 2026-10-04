'use client';
import type { ReactNode } from 'react';
import { useActiveCompany } from '@/lib/auth-client';
export default function FiscalLayout({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useActiveCompany();
  if (!activeCompanyId) return <p>Seleccioná una empresa para trabajar en facturación fiscal.</p>;
  return <div key={activeCompanyId}>{children}</div>;
}
