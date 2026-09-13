import { Injectable } from '@nestjs/common';
import type {
  DashboardSalesBucketDto,
  DashboardSalesPeriod,
  DashboardSalesSeriesResponse,
  DashboardSalesTotalsDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';

const ZERO = new Prisma.Decimal(0);

/**
 * How each period is bucketed. `granularity` goes to `date_trunc`, which
 * only accepts a fixed vocabulary — the values here are literals in this
 * file, never anything a caller supplies, so the interpolation below can
 * never carry user input.
 */
const PERIODS: Record<
  DashboardSalesPeriod,
  { granularity: 'day' | 'month'; buckets: number; step: string }
> = {
  D7: { granularity: 'day', buckets: 7, step: '1 day' },
  D30: { granularity: 'day', buckets: 30, step: '1 day' },
  M12: { granularity: 'month', buckets: 12, step: '1 month' },
};

interface BucketRow {
  bucket: string;
  total: Prisma.Decimal | null;
  cnt: bigint;
}

/**
 * The dashboard's sales-over-time chart.
 *
 * Split out of DashboardService because that class answers "what is true
 * right now" with one number per question, while this one answers "how did
 * it move" and needs windowing, bucketing and a comparison period. Both are
 * read-only aggregations over persisted Sales data and own no business rule
 * (see docs/dashboard.md).
 *
 * Every boundary is computed in the COMPANY's IANA timezone, the same rule
 * and the same reason as `DashboardService.getCompanyLocalDayRange`: a
 * server running in UTC must not draw a different Monday than the shop
 * floor lives in. Anchored to `confirmedAt`, never `occurredAt` — a sale is
 * revenue at the moment it is confirmed, not at whatever business date
 * someone typed (see docs/sales.md).
 */
@Injectable()
export class SalesSeriesService {
  constructor(private readonly prisma: PrismaService) {}

  async getSeries(
    companyId: string,
    period: DashboardSalesPeriod,
  ): Promise<DashboardSalesSeriesResponse> {
    const { granularity, buckets, step } = PERIODS[period];

    const currency = await this.pickCurrency(companyId, granularity, buckets);
    if (!currency) {
      // No confirmed sale in the window at all. Still return the empty
      // buckets so the chart draws its axis and its own "sin datos" state
      // rather than collapsing to nothing.
      const empty = await this.emptyBuckets(
        companyId,
        granularity,
        buckets,
        step,
      );
      const zero: DashboardSalesTotalsDto = {
        amount: '0',
        count: 0,
        averageTicket: '0',
      };
      return {
        period,
        currencyCode: null,
        otherCurrencyCodes: [],
        buckets: empty,
        current: zero,
        previous: zero,
        change: {
          amountPercent: null,
          countPercent: null,
          averageTicketPercent: null,
        },
      };
    }

    const [rows, current, previous] = await Promise.all([
      this.bucketRows(
        companyId,
        currency.id,
        granularity,
        buckets,
        step,
        'current',
      ),
      this.windowTotals(companyId, currency.id, granularity, buckets, 'current'),
      this.windowTotals(
        companyId,
        currency.id,
        granularity,
        buckets,
        'previous',
      ),
    ]);

    return {
      period,
      currencyCode: currency.code,
      otherCurrencyCodes: currency.others,
      buckets: rows,
      current,
      previous,
      change: {
        amountPercent: percentChange(previous.amount, current.amount),
        countPercent: percentChange(
          previous.count.toString(),
          current.count.toString(),
        ),
        averageTicketPercent: percentChange(
          previous.averageTicket,
          current.averageTicket,
        ),
      },
    };
  }

  /**
   * The window's dominant currency, plus the codes of any others present.
   *
   * Charting a sum across currencies would produce a number that means
   * nothing, so the series covers one. Picking the busiest rather than the
   * company's configured default keeps the chart pointed at whatever the
   * business is actually doing, and `others` is what stops the omission
   * from being silent.
   */
  private async pickCurrency(
    companyId: string,
    granularity: 'day' | 'month',
    buckets: number,
  ): Promise<{ id: string; code: string; others: string[] } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ currencyId: string; code: string; cnt: bigint }>
    >`
      WITH b AS (${this.boundsSql(companyId, granularity, buckets)})
      SELECT s."currencyId" AS "currencyId", c.code AS code, COUNT(*)::bigint AS cnt
      FROM sales_documents s
      JOIN currencies c ON c.id = s."currencyId"
      CROSS JOIN b
      WHERE s."companyId" = ${companyId}::uuid
        AND s.status = 'CONFIRMED'
        AND s."confirmedAt" >= b.win_start
        AND s."confirmedAt" < b.win_end
      GROUP BY 1, 2
      ORDER BY cnt DESC, code ASC
    `;
    if (rows.length === 0) return null;
    const [top, ...rest] = rows;
    return {
      id: top.currencyId,
      code: top.code,
      others: rest.map((r) => r.code),
    };
  }

  /**
   * Window boundaries as a CTE body, in company-local time.
   *
   * `win_start`/`win_end` bound the visible window; `prev_start` bounds the
   * window of the same length immediately before it. All three come back as
   * `timestamptz`, so the comparisons above are plain instant comparisons
   * and no timezone reasoning leaks into the calling query.
   *
   * The current bucket is deliberately included whole — "30 días" ends at
   * the end of today, not at this minute — so the last bar grows through
   * the day instead of the window sliding under the reader.
   */
  private boundsSql(
    companyId: string,
    granularity: 'day' | 'month',
    buckets: number,
  ): Prisma.Sql {
    // Both interpolations are literals from PERIODS above, never caller
    // input; every value that comes from outside is a bound parameter.
    const trunc = Prisma.raw(`'${granularity}'`);
    const span = Prisma.raw(`'${buckets} ${granularity}'::interval`);
    const one = Prisma.raw(`'1 ${granularity}'::interval`);
    return Prisma.sql`
      SELECT
        ((date_trunc(${trunc}, now() AT TIME ZONE co.timezone) + ${one} - ${span}) AT TIME ZONE co.timezone) AS win_start,
        ((date_trunc(${trunc}, now() AT TIME ZONE co.timezone) + ${one}) AT TIME ZONE co.timezone) AS win_end,
        ((date_trunc(${trunc}, now() AT TIME ZONE co.timezone) + ${one} - ${span} - ${span}) AT TIME ZONE co.timezone) AS prev_start,
        co.timezone AS tz
      FROM companies co
      WHERE co.id = ${companyId}::uuid
    `;
  }

  private async bucketRows(
    companyId: string,
    currencyId: string,
    granularity: 'day' | 'month',
    buckets: number,
    step: string,
    _window: 'current',
  ): Promise<DashboardSalesBucketDto[]> {
    const stepSql = Prisma.raw(`'${step}'::interval`);
    const trunc = Prisma.raw(`'${granularity}'`);
    const rows = await this.prisma.$queryRaw<BucketRow[]>`
      WITH b AS (${this.boundsSql(companyId, granularity, buckets)}),
      slots AS (
        SELECT gs AS bucket_local
        FROM b, generate_series(
          date_trunc(${trunc}, b.win_start AT TIME ZONE b.tz),
          date_trunc(${trunc}, (b.win_end AT TIME ZONE b.tz) - interval '1 microsecond'),
          ${stepSql}
        ) AS gs
      )
      SELECT
        to_char(slots.bucket_local, ${Prisma.raw(granularity === 'month' ? `'YYYY-MM'` : `'YYYY-MM-DD'`)}) AS bucket,
        COALESCE(SUM(s.total), 0) AS total,
        COUNT(s.id)::bigint AS cnt
      FROM slots
      CROSS JOIN b
      LEFT JOIN sales_documents s
        ON s."companyId" = ${companyId}::uuid
       AND s.status = 'CONFIRMED'
       AND s."currencyId" = ${currencyId}::uuid
       AND (s."confirmedAt" AT TIME ZONE b.tz) >= slots.bucket_local
       AND (s."confirmedAt" AT TIME ZONE b.tz) < slots.bucket_local + ${stepSql}
      GROUP BY slots.bucket_local
      ORDER BY slots.bucket_local
    `;
    return rows.map((r) => ({
      startsAt: bucketStartIso(r.bucket),
      key: r.bucket,
      total: (r.total ?? ZERO).toString(),
      count: Number(r.cnt),
    }));
  }

  private async emptyBuckets(
    companyId: string,
    granularity: 'day' | 'month',
    buckets: number,
    step: string,
  ): Promise<DashboardSalesBucketDto[]> {
    const stepSql = Prisma.raw(`'${step}'::interval`);
    const trunc = Prisma.raw(`'${granularity}'`);
    const rows = await this.prisma.$queryRaw<Array<{ bucket: string }>>`
      WITH b AS (${this.boundsSql(companyId, granularity, buckets)})
      SELECT to_char(gs, ${Prisma.raw(granularity === 'month' ? `'YYYY-MM'` : `'YYYY-MM-DD'`)}) AS bucket
      FROM b, generate_series(
        date_trunc(${trunc}, b.win_start AT TIME ZONE b.tz),
        date_trunc(${trunc}, (b.win_end AT TIME ZONE b.tz) - interval '1 microsecond'),
        ${stepSql}
      ) AS gs
      ORDER BY gs
    `;
    return rows.map((r) => ({
      startsAt: bucketStartIso(r.bucket),
      key: r.bucket,
      total: '0',
      count: 0,
    }));
  }

  private async windowTotals(
    companyId: string,
    currencyId: string,
    granularity: 'day' | 'month',
    buckets: number,
    which: 'current' | 'previous',
  ): Promise<DashboardSalesTotalsDto> {
    const from = Prisma.raw(which === 'current' ? 'b.win_start' : 'b.prev_start');
    const to = Prisma.raw(which === 'current' ? 'b.win_end' : 'b.win_start');
    const rows = await this.prisma.$queryRaw<
      Array<{ total: Prisma.Decimal | null; cnt: bigint }>
    >`
      WITH b AS (${this.boundsSql(companyId, granularity, buckets)})
      SELECT COALESCE(SUM(s.total), 0) AS total, COUNT(s.id)::bigint AS cnt
      FROM b
      LEFT JOIN sales_documents s
        ON s."companyId" = ${companyId}::uuid
       AND s.status = 'CONFIRMED'
       AND s."currencyId" = ${currencyId}::uuid
       AND s."confirmedAt" >= ${from}
       AND s."confirmedAt" < ${to}
    `;
    const row = rows[0];
    const amount = row?.total ?? ZERO;
    const count = Number(row?.cnt ?? 0);
    // Two decimals, half-up: the same rounding the rest of the money layer
    // uses. Zero sales means a zero ticket, not a division by zero.
    const averageTicket =
      count > 0
        ? amount.dividedBy(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : ZERO;
    return {
      amount: amount.toString(),
      count,
      averageTicket: averageTicket.toString(),
    };
  }
}

/**
 * `YYYY-MM-DD` / `YYYY-MM` to an instant at UTC midnight.
 *
 * The bucket key is already company-local wall-clock, and the frontend only
 * ever formats it as a date label — so it must be read back as that same
 * calendar date, not shifted by the reader's own offset. Pinning it to UTC
 * midnight is what guarantees that: `new Date('2026-01-05T00:00:00.000Z')`
 * formatted with `timeZone: 'UTC'` is January 5 everywhere.
 */
function bucketStartIso(key: string): string {
  const full = key.length === 7 ? `${key}-01` : key;
  return `${full}T00:00:00.000Z`;
}

/**
 * Percent change from `before` to `after`, one decimal.
 *
 * Null when there is nothing to compare against: a previous window of zero
 * has no meaningful percentage, and showing "0%" or "+100%" next to a
 * first-ever sale would state something untrue. The inputs are decimal
 * strings and the output is a display number — a ratio is not money, so
 * this is the one place a float is the right type.
 */
function percentChange(before: string, after: string): number | null {
  const b = new Prisma.Decimal(before);
  if (b.isZero()) return null;
  return new Prisma.Decimal(after)
    .minus(b)
    .dividedBy(b)
    .times(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}
