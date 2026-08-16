'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, useActiveCompany, usePermissions } from '@/lib/auth-client';
import { Topbar } from '@/components/layout/topbar';
import { NoCompanies } from '@/components/layout/no-companies';
import { SelectCompanyPrompt } from '@/components/layout/select-company-prompt';
import { AppAccessDenied } from '@/components/layout/app-access-denied';

/**
 * Session gate for every route under (app), mirroring apps/gestion:
 * check session → if valid render, if refreshable apiFetch already
 * refreshed transparently before this resolves, if invalid redirect to
 * /login. Company resolution (zero/one/many) also mirrors Gestión — see
 * docs/multi-company-architecture.md. Branch is resolved separately by
 * BranchSelector in the Topbar; it doesn't gate content yet since no
 * branch-scoped feature exists in this task.
 *
 * A third gate checks apps.facturacion.access for the active company —
 * see CLAUDE.md's authorization rules. UX convenience only; the backend
 * independently enforces every real operation regardless of this screen.
 */
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading, isError } = useMe();
  const companyCtx = useActiveCompany();
  const permissions = usePermissions();

  useEffect(() => {
    if (isError) {
      router.replace('/login');
    }
  }, [isError, router]);

  if (isLoading || isError || !data) {
    return <div className="min-h-screen bg-background" />;
  }

  let content = children;
  if (companyCtx.hasNoCompanies) {
    content = <NoCompanies />;
  } else if (companyCtx.needsSelection) {
    content = <SelectCompanyPrompt companies={companyCtx.companies} />;
  } else if (companyCtx.activeCompanyId) {
    if (permissions.isLoading) {
      return <div className="min-h-screen bg-background" />;
    }
    if (!permissions.can('apps.facturacion.access')) {
      content = <AppAccessDenied />;
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar userLabel={`${data.user.firstName} ${data.user.lastName}`} userEmail={data.user.email} />
      <main className="flex-1 overflow-auto p-4 md:p-6">{content}</main>
    </div>
  );
}
