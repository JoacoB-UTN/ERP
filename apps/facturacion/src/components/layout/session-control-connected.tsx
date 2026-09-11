'use client';

import { useRouter } from 'next/navigation';
import { useMe, useActiveCompany, useLogout } from '@/lib/auth-client';
import { useServerHealth } from '@/lib/use-server-health';
import { SessionControl } from './session-control';

/**
 * `SessionControl` wired to the live session, for the app shell.
 *
 * The entry screens build the same props themselves because they already hold
 * this data; inside the shell nothing does, and threading it down through the
 * header would put session concerns in a component that has none.
 *
 * This is the ONLY way to change company or workspace in the product. The top
 * bar used to carry a separate company selector and an always-visible
 * workspace toggle; both are here now, so there is one control to keep in sync
 * instead of three. See docs/multi-company-architecture.md for why the active
 * company is worth showing prominently — not for showing twice.
 */
export function SessionControlConnected({ compact = false }: { compact?: boolean } = {}) {
  const router = useRouter();
  const { data } = useMe();
  const companyCtx = useActiveCompany();
  const logout = useLogout();
  const { status: serverStatus } = useServerHealth();

  if (!data) return null;

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  return (
    <SessionControl
      firstName={data.user.firstName}
      lastName={data.user.lastName}
      companyName={companyCtx.activeCompany?.tradeName ?? companyCtx.activeCompany?.legalName}
      serverStatus={serverStatus}
      // The picker resolves what this user can actually reach and forwards
      // straight through when there is only one — which is why this is a link
      // to it rather than a hardcoded list of the two workspaces.
      onChangeModule={() => router.push('/modulos')}
      // Omitted with a single company: there is nothing to switch to, and an
      // action that cannot do anything is worse than no action.
      onChangeCompany={
        companyCtx.companies.length > 1 ? () => companyCtx.setActiveCompany(null) : undefined
      }
      onLogout={handleLogout}
      logoutPending={logout.isPending}
      compact={compact}
    />
  );
}
