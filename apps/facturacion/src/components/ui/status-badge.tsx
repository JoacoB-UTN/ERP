import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const tones = {
  success: 'border-success/20 bg-success-muted text-success',
  warning: 'border-warning/20 bg-warning-muted text-warning',
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-primary/15 bg-accent text-accent-foreground',
};

export function StatusBadge({
  children,
  status,
  className,
}: {
  children: ReactNode;
  status?: string;
  className?: string;
}) {
  const tone =
    status === 'CONFIRMED' || status === 'ACTIVE'
      ? 'success'
      : status === 'DRAFT'
        ? 'warning'
        : status === 'CANCELLED' || status === 'INACTIVE'
          ? 'neutral'
          : 'info';

  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full border px-2 text-[0.6875rem] leading-none font-semibold whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
