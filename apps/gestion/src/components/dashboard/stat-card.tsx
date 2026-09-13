import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * One figure from the dashboard, as a card that goes somewhere.
 *
 * These replaced a single strip of inline text. The strip fit a lot into one
 * line, but every figure in it is the headline of a screen — "3 borradores
 * abiertos" is Ventas filtered to drafts — and reading it left you to find
 * that screen yourself. As a card the number IS the way in.
 *
 * A card without `href` renders as a plain div rather than a dead link: the
 * only one today is the day's operated total, which has no screen of its own
 * (it is a sum across currencies, not a filter). Making it look clickable and
 * do nothing is worse than leaving it flat.
 */
export function StatCard({
  href,
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  href?: string;
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: 'warning';
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon
          className={cn('size-4 shrink-0', tone === 'warning' ? 'text-warning' : 'text-muted-foreground')}
          aria-hidden="true"
        />
      </div>
      <div
        className={cn(
          'mt-1.5 text-2xl leading-7 font-semibold tabular-nums',
          tone === 'warning' ? 'text-warning' : 'text-foreground',
        )}
      >
        {value}
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </>
  );

  const shell = cn(
    'block rounded-md border px-3 py-2.5 text-left',
    tone === 'warning' ? 'border-warning/25 bg-warning-muted/40' : 'border-border bg-card',
  );

  if (!href) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={href}
      className={cn(
        shell,
        'transition-colors outline-none hover:border-ring hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
      )}
    >
      {body}
    </Link>
  );
}
