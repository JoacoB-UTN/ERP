/**
 * Module marks for the picker's 32px tiles.
 *
 * Drawn here rather than picked from the icon set because these two stand for
 * the products themselves, and the nearest stock glyphs (a generic grid, a
 * generic receipt) say "some app" rather than "this one". They follow the same
 * drawing conventions as the rest of the app's icons — 24×24 canvas, 2px
 * stroke, round caps and joins, `currentColor` — so they sit next to lucide
 * glyphs without looking imported from somewhere else.
 *
 * Both are built from a container plus two content lines, at the same optical
 * weight, so neither module reads as more important than the other. They are
 * rendered at 16px, which is why detail stops at two inner lines: anything
 * finer turns to mush at that size.
 */

type ModuleIconProps = { className?: string };

const STROKE_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * Gestión — a ledger: a bound book with a spine and entries.
 *
 * The backoffice is where records are kept (customers, products, stock,
 * prices, purchases), so the mark is the record itself rather than any one of
 * those modules. The spine is what keeps it from reading as a plain document.
 */
export function GestionIcon({ className }: ModuleIconProps) {
  return (
    <svg {...STROKE_PROPS} className={className} aria-hidden focusable="false">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8.5 3v18" />
      <path d="M12 8.5h4" />
      <path d="M12 13h4" />
    </svg>
  );
}

/**
 * Facturación — a receipt: a slip with a torn bottom edge and two lines.
 *
 * The torn edge is the whole point; without it this is just a document. It is
 * what makes the mark say "sale" at a glance, which matters on a screen an
 * operator passes through many times a day.
 */
export function FacturacionIcon({ className }: ModuleIconProps) {
  return (
    <svg {...STROKE_PROPS} className={className} aria-hidden focusable="false">
      <path d="M6 3h12v18l-3-1.75L12 21l-3-1.75L6 21z" />
      <path d="M9.5 8h5" />
      <path d="M9.5 12h5" />
    </svg>
  );
}
