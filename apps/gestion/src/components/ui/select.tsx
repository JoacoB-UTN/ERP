import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A plain native `<select>` styled to match Input — no Base UI/Radix
 * primitive wired up yet for this project (see the audit list page's
 * inline `selectClassName` precedent). Extracted here once customer forms
 * needed several dropdowns (tipo de cliente, documento, condición fiscal,
 * provincia, tipo de domicilio) to avoid repeating the class string.
 */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-(--control-height) w-full min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 md:text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
