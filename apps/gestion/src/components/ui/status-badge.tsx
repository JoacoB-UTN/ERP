import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type StatusTone = 'success' | 'warning' | 'neutral' | 'danger' | 'info';

const toneClassNames: Record<StatusTone, string> = {
  success: 'border-success/20 bg-success-muted text-success',
  warning: 'border-warning/20 bg-warning-muted text-warning',
  neutral: 'border-border bg-muted text-muted-foreground',
  danger: 'border-destructive/20 bg-destructive-muted text-destructive',
  info: 'border-primary/15 bg-accent text-accent-foreground',
};

export function statusTone(status: string): StatusTone {
  if (['ACTIVE', 'CONFIRMED', 'CONSUMED'].includes(status)) return 'success';
  if (['DRAFT', 'PARTIALLY_CONSUMED', 'PENDING'].includes(status)) return 'warning';
  if (['INACTIVE', 'CANCELLED', 'RELEASED', 'EXPIRED'].includes(status)) return 'neutral';
  return 'info';
}

export function StatusBadge({
  children,
  status,
  tone,
  className,
}: {
  children: ReactNode;
  status?: string;
  tone?: StatusTone;
  className?: string;
}) {
  const resolvedTone = tone ?? (status ? statusTone(status) : 'neutral');

  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full border px-2 text-[0.6875rem] leading-none font-semibold whitespace-nowrap',
        toneClassNames[resolvedTone],
        className,
      )}
    >
      {children}
    </span>
  );
}
