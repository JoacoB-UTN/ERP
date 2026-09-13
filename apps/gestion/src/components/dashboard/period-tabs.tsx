'use client';

import { DASHBOARD_SALES_PERIOD_LABELS, dashboardSalesPeriodValues, type DashboardSalesPeriod } from '@erp/shared';

import { cn } from '@/lib/utils';

/**
 * Segmented control for the chart's window.
 *
 * A real radio group rather than a row of buttons: these are one choice with
 * several options, so arrow keys should move between them and a screen
 * reader should announce "2 of 3", both of which come free from radio
 * semantics and neither of which a set of buttons gives you.
 *
 * Order runs shortest window first, matching how the list reads left to
 * right; the labels come from the shared package so the API's period codes
 * and their Spanish names cannot drift apart.
 */
export function PeriodTabs({
  value,
  onChange,
  className,
}: {
  value: DashboardSalesPeriod;
  onChange: (period: DashboardSalesPeriod) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Período"
      className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5', className)}
    >
      {dashboardSalesPeriodValues.map((period) => {
        const selected = period === value;
        return (
          <button
            key={period}
            type="button"
            role="radio"
            aria-checked={selected}
            // Only the selected option is tabbable, so Tab moves past the
            // whole group and the arrow keys move within it — the standard
            // radio-group behaviour.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(period)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = dashboardSalesPeriodValues.indexOf(period);
              const next =
                e.key === 'ArrowRight'
                  ? (i + 1) % dashboardSalesPeriodValues.length
                  : (i - 1 + dashboardSalesPeriodValues.length) % dashboardSalesPeriodValues.length;
              onChange(dashboardSalesPeriodValues[next]);
            }}
            className={cn(
              'rounded-[0.3125rem] px-2.5 py-1 text-[0.8125rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
              selected
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {DASHBOARD_SALES_PERIOD_LABELS[period]}
          </button>
        );
      })}
    </div>
  );
}
