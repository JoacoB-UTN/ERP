'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './sidebar';
import { SessionControlConnected } from './session-control-connected';
import { Button } from '@/components/ui/button';

/**
 * Application shell: sidebar + main content area.
 *
 * No top bar and no status strip. Everything both used to hold — identity,
 * active company, workspace, sign-out, server connection — is in one floating
 * session control at the top-right of the content. Two horizontal bands for a
 * handful of readouts cost rows of the table between them, and on a 1366×768
 * screen rows are what this workspace is for.
 *
 * The one thing the bar still did is open the navigation on mobile, where the
 * sidebar is a drawer rather than a column. That became a floating button
 * instead of a whole bar: it is the only reason a phone needs chrome up there.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar mobileOpen={navigationOpen} onMobileOpenChange={setNavigationOpen} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Floating rather than in a bar of its own: it needs to be reachable
            from every screen, but a whole horizontal strip to hold one control
            costs rows of the table underneath it. */}
        {/* A 64px band, not a bar: nothing is drawn, but centring the control
            in it puts it on the same line as the sidebar's logo, and lets the
            content below start exactly where the sidebar's navigation does. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-16 items-center justify-end px-4 md:px-6">
          <div className="pointer-events-auto">
            <SessionControlConnected />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="fixed top-4 left-4 z-40 shadow-sm md:hidden"
          aria-label="Abrir navegación"
          onClick={() => setNavigationOpen(true)}
        >
          <Menu className="size-4" />
        </Button>
        <main
          data-gestion-workspace
          // pt-16 clears the 64px band above, so the page's first line lands on
          // the same baseline as the sidebar's first navigation item.
          className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pt-16 pb-4 md:px-6 md:pb-5"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
