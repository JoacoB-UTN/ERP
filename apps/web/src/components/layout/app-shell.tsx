import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';

/**
 * Structural shell for future modules: sidebar + header + main content
 * area. Responsive down to mobile (sidebar hides below `md`); no business
 * navigation exists yet, so the sidebar only shows a placeholder.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
