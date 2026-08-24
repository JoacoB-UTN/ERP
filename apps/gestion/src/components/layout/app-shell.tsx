'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { StatusBar } from './status-bar';

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
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar mobileOpen={navigationOpen} onMobileOpenChange={setNavigationOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          userLabel={userLabel}
          userEmail={userEmail}
          onOpenNavigation={() => setNavigationOpen(true)}
        />
        <main data-gestion-workspace className="min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
          {children}
        </main>
        <StatusBar userEmail={userEmail} />
      </div>
    </div>
  );
}
