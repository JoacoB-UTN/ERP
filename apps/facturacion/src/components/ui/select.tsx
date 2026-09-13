import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A plain native `<select>` styled to match Input — no Base UI/Radix primitive
 * wired up yet for this project. Extracted here once customer forms needed
 * several dropdowns (tipo de cliente, documento, condición fiscal, provincia,
 * tipo de domicilio) to avoid repeating the class string.
 *
 * The chevron is drawn by us, not by the browser. A native select's arrow is
 * placed by the user agent: it sits hard against the field's inline edge,
 * ignores the element's padding, and looks nothing like the lucide chevrons
 * used everywhere else. `appearance-none` removes it so the position is ours —
 * 12px from the right edge, vertically centred, matching the inset of the
 * field's own text.
 *
 * It is a background image rather than an element because this renders a bare
 * `<select>`: wrapping it to position an icon would mean the caller's
 * `className` (widths like `max-w-48`) lands on the wrapper or the field but
 * not both, and 71 call sites depend on the current behaviour.
 *
 * `--select-chevron` lives in globals.css beside the colour tokens, because a
 * data URI cannot read `currentColor` and the arrow's colour has to be written
 * out per theme. Keeping it there is what stops those two literals from
 * drifting away from `--muted-foreground`.
 */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-(--control-height) w-full min-w-0 appearance-none rounded-md border border-input bg-card py-1.5 pr-9 pl-3 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 md:text-sm',
        // Arbitrary properties, not `bg-*` utilities: `bg-card` already owns
        // background-color, and mixing the two in one class group makes
        // tailwind-merge drop one of them.
        '[background-image:var(--select-chevron)] [background-position:right_0.75rem_center] [background-repeat:no-repeat] [background-size:1rem_1rem]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
