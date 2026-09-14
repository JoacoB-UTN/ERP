'use client';

import { useId, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

export interface AreaChartPoint {
  /** Stable key, also the accessible label for the point. */
  key: string;
  label: string;
  value: number;
  /** Already formatted for display — the chart never formats money itself. */
  display: string;
}

/**
 * A line-and-area chart, drawn as plain SVG.
 *
 * No chart library. This is one series with no zoom, no brush and no
 * stacking; the whole thing is a `<path>` built from a linear scale, which
 * is a few dozen lines. Pulling in Recharts (and D3 under it) for that would
 * add more code to the bundle than the entire Gestión app currently ships
 * for its own screens, so the trade only makes sense once there is a second
 * or third chart with real interaction needs.
 *
 * Coordinates are computed in a fixed viewBox and the SVG scales to its
 * container, so nothing here depends on measuring the DOM — the chart draws
 * correctly on the server, at any width, with no layout effect and no
 * resize observer.
 *
 * Colour comes from `--chart-1` via `currentColor`, so it follows the theme
 * rather than hard-coding a hex that would be invisible in one of them.
 */
export function AreaChart({
  points,
  className,
  height = 220,
  emptyLabel = 'Sin datos en este período.',
}: {
  points: AreaChartPoint[];
  className?: string;
  height?: number;
  emptyLabel?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  // A fixed drawing space; the SVG itself is responsive via viewBox.
  const W = 800;
  const H = 240;
  const PAD_X = 8;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 24;

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const max = Math.max(...points.map((p) => p.value));
    // A flat all-zero series would divide by zero and, worse, draw a line
    // pinned to the top of the box as if it were a maximum. Treat it as a
    // baseline instead.
    const scaleMax = max > 0 ? max : 1;

    const innerW = W - PAD_X * 2;
    const innerH = H - PAD_TOP - PAD_BOTTOM;
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;

    const xy = points.map((p, i) => ({
      x: PAD_X + (points.length > 1 ? i * stepX : innerW / 2),
      y: PAD_TOP + innerH - (p.value / scaleMax) * innerH,
    }));

    const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const baseline = PAD_TOP + innerH;
    const area = `${line} L${xy[xy.length - 1].x.toFixed(2)} ${baseline} L${xy[0].x.toFixed(2)} ${baseline} Z`;

    return { xy, line, area, baseline, max, stepX };
  }, [points]);

  if (!geometry) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground',
          className,
        )}
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const active = hover !== null ? points[hover] : null;
  const activePoint = hover !== null ? geometry.xy[hover] : null;

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Serie de ${points.length} puntos, máximo ${points.reduce((a, b) => (b.value > a.value ? b : a)).display}`}
        className="w-full text-chart-1"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Four horizontal guides, not a full grid: enough to judge height
            against, few enough not to compete with the line. */}
        {[0, 0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={PAD_TOP + (H - PAD_TOP - PAD_BOTTOM) * f}
            y2={PAD_TOP + (H - PAD_TOP - PAD_BOTTOM) * f}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={geometry.baseline}
          y2={geometry.baseline}
          className="stroke-border"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        <path d={geometry.area} fill={`url(#${gradientId})`} />
        {/* `non-scaling-stroke` everywhere: the viewBox is stretched
            horizontally to fit the container, and without it the line would
            come out thicker or thinner depending on the window width. */}
        <path
          d={geometry.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {activePoint && (
          <>
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={PAD_TOP}
              y2={geometry.baseline}
              className="stroke-muted-foreground"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r={4}
              className="fill-background stroke-current"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}

        {/* One invisible hit band per point rather than a mousemove handler:
            the band is the whole column, so the tooltip appears anywhere over
            that day rather than only within a few pixels of the line. */}
        {points.map((p, i) => (
          <rect
            key={p.key}
            x={geometry.xy[i].x - geometry.stepX / 2}
            y={0}
            width={geometry.stepX || W}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {active && activePoint && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
          style={{
            left: `${(activePoint.x / W) * 100}%`,
            top: `${(activePoint.y / H) * height - 8}px`,
          }}
        >
          <div className="font-medium">{active.display}</div>
          <div className="text-muted-foreground">{active.label}</div>
        </div>
      )}
    </div>
  );
}
