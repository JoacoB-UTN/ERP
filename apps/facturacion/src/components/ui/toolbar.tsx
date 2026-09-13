import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Compact, operational filter row — no card band. Matches Gestión → Ventas,
 * the approved desktop-ERP reference (see docs/desktop-ui-direction.md):
 * filters sit directly in the page flow, not inside a bordered panel.
 *
 * `actions` puts the screen's primary button on this line instead of up in
 * the heading. Both are 32px (`--control-height-sm`), so the button's top and
 * bottom edges land exactly on the search field's — from the heading it sat on
 * its own baseline with nothing to line up against. It also puts "search the
 * list" and "add to the list" next to each other, which is how they are used.
 */
export function Toolbar({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {/* The landmark stays on the filters alone: a create button is not part
          of the search affordance and shouldn't be announced as such. */}
      <div role="search" className="flex flex-wrap items-center gap-2">
        {children}
      </div>
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
