'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useLogout } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { CompanySelector } from './company-selector';

export function Header({ userLabel, userEmail }: { userLabel: string; userEmail: string }) {
  const router = useRouter();
  const logout = useLogout();

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 md:px-6">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">Gestión</span>
        <CompanySelector />
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right leading-tight">
          <p className="text-sm font-medium">{userLabel}</p>
          <p className="text-xs text-muted-foreground">{userEmail}</p>
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
