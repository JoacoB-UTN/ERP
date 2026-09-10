import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Compact, operational filter row — no card band. Matches Gestión → Ventas,
 * the approved desktop-ERP reference (see docs/desktop-ui-direction.md):
 * filters sit directly in the page flow, not inside a bordered panel.
 */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="search" className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  );
}
