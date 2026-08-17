import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="search"
      className={cn(
        'flex flex-col gap-2 border-y border-border bg-card/60 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center',
        className,
      )}
    >
      {children}
    </div>
  );
}
