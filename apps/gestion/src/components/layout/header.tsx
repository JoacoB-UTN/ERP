'use client';

import { useRouter } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { useLogout } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { CompanySelector } from './company-selector';
import { WorkspaceSwitcher } from './workspace-switcher';

export function Header({
  userLabel,
  userEmail,
  onOpenNavigation,
}: {
  userLabel: string;
  userEmail: string;
  onOpenNavigation: () => void;
}) {
  const router = useRouter();
  const logout = useLogout();

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  return (
    <header className="sticky top-0 z-30 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Abrir navegación"
          onClick={onOpenNavigation}
        >
          <Menu className="size-4" />
        </Button>
        <WorkspaceSwitcher />
        <div className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
        <CompanySelector />
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="hidden min-w-0 text-right leading-tight sm:block">
          <p className="text-sm font-medium">{userLabel}</p>
          <p className="max-w-56 truncate text-xs text-muted-foreground">{userEmail}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Cerrar sesión"
          onClick={handleLogout}
          disabled={logout.isPending}
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
