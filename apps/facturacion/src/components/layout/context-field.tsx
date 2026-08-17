import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function ContextField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-[0.625rem] leading-3 font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
      <div className="flex h-7 min-w-0 items-center text-xs font-medium text-foreground">{children}</div>
    </div>
  );
}
