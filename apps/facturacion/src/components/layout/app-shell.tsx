'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './sidebar';
import { SessionControlConnected } from './session-control-connected';
import { Button } from '@/components/ui/button';

/**
 * Application shell: side panel + main content area.
 *
 * Same shape as Gestión's so the two workspaces read as one product. What
 * differs is what the panel holds — see sidebar.tsx: two modes rather than a
 * grouped tree, plus the operating context (branch, warehouse, price list) that
 * used to sit in the top bar.
 *
 * There is no top bar. The session control floats over the top-right of the
 * content instead: it has to be reachable from every screen, but a horizontal
 * strip to hold one control costs vertical space that a counter tool spends
 * better on the cart.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar mobileOpen={navigationOpen} onMobileOpenChange={setNavigationOpen} />
      <div className="relative flex min-w-0 flex-1 flex-col">
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
          data-facturacion-workspace
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
