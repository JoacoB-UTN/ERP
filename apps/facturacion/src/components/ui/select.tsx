import * as React from 'react';

import { cn } from '@/lib/utils';

/** A plain native `<select>` styled to match Input — same precedent as apps/gestion/src/components/ui/select.tsx. */
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
