'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, useActiveCompany, usePermissions, useRealtimeSync } from '@/lib/auth-client';
import { AppShell } from '@/components/layout/app-shell';
import { NoCompanies } from '@/components/layout/no-companies';
import { SelectCompanyPrompt } from '@/components/layout/select-company-prompt';

/**
 * Session gate for every route under (app), mirroring apps/gestion:
 * check session → if valid render, if refreshable apiFetch already
 * refreshed transparently before this resolves, if invalid redirect to
 * /login. Company resolution (zero/one/many) also mirrors Gestión — see
 * docs/multi-company-architecture.md. Branch is resolved separately by
 * BranchSelector in the side panel; it doesn't gate content yet since no
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

  // Cross-workstation live updates (see docs/desktop-lan-architecture.md)
  // — only once authenticated with a resolved active company; REST stays
  // fully usable on its own regardless of whether this connects.
  useRealtimeSync({ enabled: !isLoading && !isError && !!data && !!companyCtx.activeCompanyId });

  // Computed before any early return so the redirect effect below can depend on
  // it — hooks cannot live after a conditional return.
  const lacksAppAccess =
    !!companyCtx.activeCompanyId && !permissions.isLoading && !permissions.can('apps.facturacion.access');

  useEffect(() => {
    if (isError) {
      router.replace('/login');
    }
  }, [isError, router]);

  useEffect(() => {
    // Not a dead end any more: the picker knows every workspace this user does
    // have, and forwards them straight there when it is the only one.
    if (lacksAppAccess) {
      router.replace('/modulos');
    }
  }, [lacksAppAccess, router]);

  if (isLoading || isError || !data || lacksAppAccess) {
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
  }

  return <AppShell>{content}</AppShell>;
}
