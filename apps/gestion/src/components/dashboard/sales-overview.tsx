'use client';

import { useState } from 'react';
import { formatAmount, formatMoney, type DashboardSalesPeriod } from '@erp/shared';

import { useDashboardSalesSeries } from '@/lib/auth-client';
import { AreaChart, type AreaChartPoint } from '@/components/dashboard/area-chart';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PeriodTabs } from '@/components/dashboard/period-tabs';
import { Button } from '@/components/ui/button';

const COMPARISON_LABEL: Record<DashboardSalesPeriod, string> = {
  D7: 'vs. los 7 días previos',
  D30: 'vs. los 30 días previos',
  M12: 'vs. los 12 meses previos',
};

/**
 * Bucket keys are `YYYY-MM-DD` / `YYYY-MM` in the COMPANY's timezone, and
 * the API pins them to UTC midnight precisely so they survive the trip.
 * Formatting them back with `timeZone: 'UTC'` is what keeps a sale on the
 * 5th labelled "5 sept" for a reader whose own clock is hours away — without
 * it, anyone west of the company would see every bucket shifted a day.
 */
function formatBucketLabel(key: string, period: DashboardSalesPeriod): string {
  const date = new Date(key.length === 7 ? `${key}-01T00:00:00.000Z` : `${key}T00:00:00.000Z`);
  return period === 'M12'
    ? date.toLocaleDateString('es-AR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Sales over time: three headline figures and the chart behind them.
 *
 * All four read the same window, so the period control sits above the whole
 * block rather than on the chart alone — a card that said "+51%" while the
 * chart showed a different span would be a trap.
 *
 * Money arrives as decimal strings and is formatted, never parsed: the only
 * place a figure becomes a JS number is the chart's own geometry, where it
 * is a pixel coordinate and nothing else. The value printed on screen always
 * comes from `formatMoney` over the original string.
 */
export function SalesOverview() {
  const [period, setPeriod] = useState<DashboardSalesPeriod>('D30');
  const seriesQuery = useDashboardSalesSeries(period);
  const data = seriesQuery.data;

  const currency = data?.currencyCode;
  // Two formatters on purpose: the cards state the currency in their label
  // so the figure stays short, while the chart tooltip is read on its own
  // and has to carry it.
  const money = (value: string) => (currency ? formatMoney(value, currency) : value);
  const amount = (value: string) => formatAmount(value);
  const withCurrency = (label: string) => (currency ? `${label} (${currency})` : label);

  const points: AreaChartPoint[] =
    data?.buckets.map((b) => ({
      key: b.key,
      label: formatBucketLabel(b.key, period),
      value: Number(b.total),
      display: money(b.total),
    })) ?? [];

  const sparkline = data?.buckets.map((b) => Number(b.total)) ?? [];
  const countSparkline = data?.buckets.map((b) => b.count) ?? [];

  if (seriesQuery.isError) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive-muted px-4 py-3">
        <p className="text-sm text-destructive">No pudimos cargar la evolución de ventas.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => seriesQuery.refetch()}>
          Reintentar
        </Button>
      </section>
    );
  }

  // `placeholderData` keeps the previous window on screen while the next
  // loads, so this only fires on the very first render of the block.
  if (!data) {
    return (
      <section className="flex flex-col gap-3" aria-busy="true">
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Evolución de ventas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Ventas</h2>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          href="/ventas"
          label={withCurrency('Facturado')}
          value={amount(data.current.amount)}
          changePercent={data.change.amountPercent}
          comparisonLabel={COMPARISON_LABEL[period]}
          series={sparkline}
        />
        <MetricCard
          href="/ventas"
          label="Ventas confirmadas"
          value={data.current.count.toLocaleString('es-AR')}
          changePercent={data.change.countPercent}
          comparisonLabel={COMPARISON_LABEL[period]}
          series={countSparkline}
        />
        <MetricCard
          label={withCurrency('Ticket promedio')}
          value={amount(data.current.averageTicket)}
          changePercent={data.change.averageTicketPercent}
          comparisonLabel={COMPARISON_LABEL[period]}
          series={sparkline}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <AreaChart points={points} height={220} />
        {/* First, middle and last only. One label per bucket is unreadable at
            30 days and unnecessary — the tooltip carries the exact date. */}
        {points.length > 1 && (
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{points[0].label}</span>
            {points.length > 2 && <span>{points[Math.floor(points.length / 2)].label}</span>}
            <span>{points[points.length - 1].label}</span>
          </div>
        )}
      </div>

      {data.otherCurrencyCodes.length > 0 && (
        // Never blend currencies into one total. Saying which ones are
        // missing is the difference between a partial chart and a wrong one.
        <p className="text-xs text-muted-foreground">
          Solo se muestran las ventas en {currency}. También hubo ventas en{' '}
          {data.otherCurrencyCodes.join(', ')}.
        </p>
      )}
    </section>
  );
}
