import { useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * The little filled line at the bottom of a metric card.
 *
 * Deliberately not `AreaChart` with a small height: this one has no axes, no
 * guides, no hover and no tooltip, and adding flags to turn all of that off
 * would leave a component that is mostly branches. It is also purely
 * decorative — the number above it is the fact, this only says which way it
 * has been going — so it is `aria-hidden` and contributes nothing to the
 * accessibility tree.
 */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const gradientId = useId();
  if (values.length < 2) return null;

  const W = 200;
  const H = 48;
  const max = Math.max(...values);
  const scaleMax = max > 0 ? max : 1;
  const stepX = W / (values.length - 1);

  const xy = values.map((v, i) => ({
    x: i * stepX,
    // 2px of headroom top and bottom so the peak's stroke is not clipped.
    y: 2 + (H - 4) - (v / scaleMax) * (H - 4),
  }));
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('h-12 w-full text-chart-1', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
