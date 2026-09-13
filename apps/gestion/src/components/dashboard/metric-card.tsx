'use client';

import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { Sparkline } from '@/components/dashboard/sparkline';
import { cn } from '@/lib/utils';

/**
 * How a percentage change is shown.
 *
 * `null` renders nothing at all rather than "0%" or "—": the backend returns
 * null when the previous window had no sales, and there is no honest
 * percentage to state against zero. A first-ever sale is not "+100%".
 *
 * Down is not automatically bad — this is used for revenue, order count and
 * average ticket, and a falling average ticket next to rising volume is a
 * normal, fine thing — but green/red is the convention operators read
 * fastest here, so direction gets the colour and the arrow carries the
 * meaning for anyone who cannot separate the two.
 */
function ChangeChip({ percent }: { percent: number | null }) {
  if (percent === null) return null;
  const up = percent >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-sm font-medium',
        up ? 'text-success' : 'text-destructive',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {up ? '+' : ''}
      {percent.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%
    </span>
  );
}

/**
 * A headline figure: label, value, how it moved, and the shape of the window
 * behind it.
 *
 * `href` is optional and the card only looks clickable when it has one — an
 * average that has no screen of its own stays flat rather than pretending.
 */
export function MetricCard({
  label,
  value,
  changePercent,
  comparisonLabel,
  series,
  href,
  className,
}: {
  label: string;
  value: string;
  changePercent?: number | null;
  comparisonLabel?: string;
  series?: number[];
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="text-sm font-semibold text-muted-foreground">{label}</div>
      {/* The figure owns its line and never wraps. Beside the change chip it
          broke "ARS 305.500,00" across two lines in a 215px card — measured —
          and a money value split mid-number is unreadable. The currency
          lives in the label instead of the figure for the same reason: with
          "ARS " in front, the number needed 185px against 181px of card. */}
      <div className="mt-1 truncate text-2xl leading-8 font-semibold tabular-nums text-foreground lg:text-3xl lg:leading-9">
        {value}
      </div>
      {(changePercent ?? null) !== null && (
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
          <ChangeChip percent={changePercent ?? null} />
          {comparisonLabel && <span className="text-xs text-muted-foreground">{comparisonLabel}</span>}
        </div>
      )}
      {series && series.length > 1 && (
        <div className="-mx-4 -mb-4 mt-3">
          <Sparkline values={series} />
        </div>
      )}
    </>
  );

  const shell = cn(
    'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-4',
    className,
  );

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      href={href}
      className={cn(
        shell,
        'transition-colors outline-none hover:border-ring hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
      )}
    >
      {body}
    </Link>
  );
}
