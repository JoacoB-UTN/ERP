import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Compact, operational filter row — no card band. Matches Gestión → Ventas,
 * the approved desktop-ERP reference (see docs/desktop-ui-direction.md):
 * filters sit directly in the page flow, not inside a bordered panel.
 *
 * `actions` puts the screen's primary button on this line instead of up in
 * the heading. Both are 32px (`--control-height-sm`), so the button's top and
 * bottom edges land exactly on the first filter's — from the heading it sat on
 * its own baseline with nothing to line up against. It also puts "search the
 * list" and "add to the list" next to each other, which is how they are used.
 *
 * The wrapping is deliberately split in two. Filters wrap among themselves in
 * their own flex container; the outer row does not wrap at all, so the button
 * stays on the first line no matter how many filters a screen has. With one
 * flat wrapping row it worked on Roles (one input) and broke on Clientes,
 * where four filters filled the line and pushed the button onto a second one —
 * measured at top 186 against the search field's 106.
 *
 * `items-start` rather than `items-center`: with two rows of filters, centring
 * would float the button between them instead of level with the first.
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
    <div className={cn('flex items-start gap-2', className)}>
      {/* The landmark stays on the filters alone: a create button is not part
          of the search affordance and shouldn't be announced as such. */}
      <div role="search" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
