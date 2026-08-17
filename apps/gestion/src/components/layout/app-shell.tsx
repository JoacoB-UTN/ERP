'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';

/**
 * Application shell: sidebar + header + main content area. Responsive
 * down to mobile (sidebar hides below `md`).
 */
export function AppShell({
  children,
  userLabel,
  userEmail,
}: {
  children: ReactNode;
  userLabel: string;
  userEmail: string;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar mobileOpen={navigationOpen} onMobileOpenChange={setNavigationOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          userLabel={userLabel}
          userEmail={userEmail}
          onOpenNavigation={() => setNavigationOpen(true)}
        />
        <main data-gestion-workspace className="min-w-0 flex-1 px-5 py-5 md:px-6 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
