import Image from 'next/image';

import { cn } from '@/lib/utils';

/** Intrinsic size of the source asset (900x260), kept as one ratio source. */
const ASPECT_RATIO = 900 / 260;
const DISPLAY_WIDTH = 200;

/**
 * The company's logotype.
 *
 * Two assets rather than one recoloured file: the logo is a raster PNG, so its
 * colour can't follow `currentColor` the way an inlined SVG would. Which one is
 * visible is decided by CSS (`dark:` variants) instead of by reading the theme
 * in JS — that keeps it correct during server rendering, with no flash of the
 * wrong version on hydration.
 *
 * `priority` because this is the largest element above the fold on the login
 * screen; lazy-loading it would show an empty gap on first paint.
 */
function LogoMark({ className }: { className?: string }) {
  const height = Math.round(DISPLAY_WIDTH / ASPECT_RATIO);
  const shared = 'h-auto w-full';

  return (
    // The default width is a class, not an inline style, so a caller can
    // override it: an inline style wins over any class and would silently
    // ignore a `w-*` passed in — which is exactly what happened when the
    // sidebar asked for a narrower mark and got a squashed 200px one instead.
    <span
      className={cn('inline-block w-[200px] shrink-0', className)}
      role="img"
      aria-label="Casablanca"
    >
      <Image
        src="/casablanca-logo-black.png"
        alt=""
        width={DISPLAY_WIDTH}
        height={height}
        priority
        className={cn(shared, 'dark:hidden')}
      />
      <Image
        src="/casablanca-logo-white.png"
        alt=""
        width={DISPLAY_WIDTH}
        height={height}
        priority
        className={cn(shared, 'hidden dark:block')}
      />
    </span>
  );
}

export { LogoMark };

/**
 * The compact mark for the collapsed rail: the "C" on its own.
 *
 * Same two-asset, CSS-switched approach as `LogoMark` above and for the same
 * reason. The light file carries an opaque white tile, which is invisible
 * against the sidebar's own white background, so it reads as the letter alone.
 */
function LogoMarkCompact({ className }: { className?: string }) {
  const shared = 'size-7 object-contain';

  return (
    <span className={cn('inline-flex', className)} role="img" aria-label="Casablanca">
      <Image
        src="/favicon.ico"
        alt=""
        width={28}
        height={28}
        priority
        className={cn(shared, 'dark:hidden')}
      />
      <Image
        src="/favicon-dark.png"
        alt=""
        width={28}
        height={28}
        priority
        className={cn(shared, 'hidden dark:block')}
      />
    </span>
  );
}

export { LogoMarkCompact };
