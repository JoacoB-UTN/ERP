'use client';

import { useRouter } from 'next/navigation';
import { useLogout, useActiveCompany } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

/**
 * Shown when the user has an active company but lacks apps.gestion.access
 * for it — see CLAUDE.md ("backend authorization still protects real
 * operations," this screen is UX, not the security boundary). The header
 * above also has a company selector + logout button; these are repeated
 * here since the prompt calls them out as expected on this exact screen.
 */
export function AppAccessDenied() {
  const router = useRouter();
  const logout = useLogout();
  const { setActiveCompany, companies } = useActiveCompany();

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-medium">No tenés permisos para acceder a Gestión en esta empresa.</p>
      <div className="flex gap-2">
        {companies.length > 1 && (
          <Button type="button" variant="outline" onClick={() => setActiveCompany(null)}>
            Cambiar empresa
          </Button>
        )}
        <Button type="button" variant="outline" onClick={handleLogout} disabled={logout.isPending}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
