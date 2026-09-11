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
      {/* Sentence case at the sidebar's own section-label size. The uppercase,
          letter-spaced treatment this used to have is the SaaS "eyebrow" tic
          docs/desktop-ui-direction.md calls out, and it made this block read as
          a different design system from Gestión's sidebar sections. */}
      <span className="text-[0.6875rem] font-semibold text-muted-foreground/80">{label}</span>
      <div className="flex min-w-0 items-center text-sm text-foreground">{children}</div>
    </div>
  );
}
