'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, useActiveCompany, usePermissions, useRealtimeSync } from '@/lib/auth-client';
import { AppShell } from '@/components/layout/app-shell';
import { NoCompanies } from '@/components/layout/no-companies';
import { SelectCompanyPrompt } from '@/components/layout/select-company-prompt';
import { AppAccessDenied } from '@/components/layout/app-access-denied';

/**
 * Session gate for every route under (app). Implements the startup
 * behavior from CLAUDE.md: check session → if valid render, if
 * refreshable the underlying apiFetch already refreshed transparently
 * before this resolves, if invalid redirect to /login. No separate
 * "refreshing…" UI state is needed because by the time useMe() settles,
 * a refresh (if any) has already happened.
 *
 * Once authenticated, a second gate resolves the active COMPANY (see
 * docs/multi-company-architecture.md): zero accessible companies shows a
 * dedicated empty state (never a redirect loop), exactly one auto-selects
 * silently, and more than one prompts for a fast pick — matching
 * CLAUDE.md's "ask only when there's actually a decision to make."
 *
 * A third gate then checks apps.gestion.access for the active company —
 * see CLAUDE.md's authorization rules. This is a UX convenience only; the
 * backend independently enforces every real operation regardless of what
 * this screen shows.
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

  useEffect(() => {
    if (isError) {
      router.replace('/login');
    }
  }, [isError, router]);

  if (isLoading || isError || !data) {
    // Intentionally blank rather than a spinner — this state is normally
    // brief, and avoids a flash of shell UI for a session that turns out
    // to be invalid.
    return <div className="min-h-screen bg-background" />;
  }

  let content = children;
  if (companyCtx.hasNoCompanies) {
    content = <NoCompanies />;
  } else if (companyCtx.needsSelection) {
    content = <SelectCompanyPrompt companies={companyCtx.companies} />;
  } else if (companyCtx.activeCompanyId) {
    if (permissions.isLoading) {
      // Avoid flashing real content before we know whether this company
      // grants apps.gestion.access.
      return <div className="min-h-screen bg-background" />;
    }
    if (!permissions.can('apps.gestion.access')) {
      content = <AppAccessDenied />;
    }
  }

  return (
    <AppShell userLabel={`${data.user.firstName} ${data.user.lastName}`} userEmail={data.user.email}>
      {content}
    </AppShell>
  );
}
