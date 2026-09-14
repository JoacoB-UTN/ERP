import { z } from 'zod';

/**
 * Decimal-safe handling for money/percentage fields (creditLimit,
 * discountPercentage) — see CLAUDE.md's NUMERIC-not-float rule and
 * docs/customers.md. Values cross the wire as strings in both directions
 * (never `number`) so JS float imprecision never touches them; Prisma
 * accepts a numeric string directly for `Decimal` columns.
 */

const numericStringPattern = /^-?\d+(\.\d+)?$/;

/** True when `value` is a well-formed decimal string (optional leading `-`, digits, optional fractional part) — the same shape every schema below requires. */
export function isDecimalString(value: string): boolean {
  return numericStringPattern.test(value);
}

/** Accepts string or number input (forms/JSON both happen), always emits a trimmed numeric string or null. */
export const optionalDecimalSchema = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str === '' ? null : str;
  })
  .refine((value) => value === null || numericStringPattern.test(value), {
    message: 'Debe ser un número válido.',
  });

/** Same as optionalDecimalSchema but additionally constrained to [0, 100] — for discountPercentage. */
export const percentageSchema = optionalDecimalSchema.refine(
  (value) => value === null || (Number(value) >= 0 && Number(value) <= 100),
  { message: 'El descuento debe estar entre 0% y 100%.' },
);

/** Formats a decimal string for display — e.g. "1500.0000" -> "1.500,00" is a UI concern; this only trims trailing zeros for a plain numeric label. */
export function formatDecimalDisplay(value: string | null | undefined, fractionDigits = 2): string | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: fractionDigits });
}

/**
 * Required signed quantity — used for inventory quantities (StockMovement,
 * StockAdjustmentLine, ...). Unlike optionalDecimalSchema this is never
 * null/undefined; "must not be zero" is a domain rule enforced at the call
 * site (a schema can't know which zero-check message fits the context) —
 * see docs/inventory.md.
 */
export const quantitySchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => numericStringPattern.test(value), { message: 'Debe ser un número válido.' });

/**
 * Required money amount — used for PriceListItem.price. Zero is a
 * legitimate price (bonificaciones, muestras); negative is never allowed.
 * See docs/pricing.md.
 */
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => numericStringPattern.test(value), { message: 'Debe ser un número válido.' })
  .refine((value) => Number(value) >= 0, { message: 'El precio no puede ser negativo.' });

/**
 * Adjustment magnitude for a DERIVED price list or a bulk adjustment —
 * percentage points or a money amount depending on AdjustmentType.
 * Direction always comes from AdjustmentType, never a sign on this value
 * — see docs/pricing.md.
 */
export const adjustmentValueSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => numericStringPattern.test(value), { message: 'Debe ser un número válido.' })
  .refine((value) => Number(value) >= 0, { message: 'El valor del ajuste no puede ser negativo.' });

/**
 * Currency-aware money display — e.g. formatMoney('18500', 'ARS', 2) ->
 * "ARS 18.500,00" (es-AR locale). Purely presentation: the Decimal string
 * stays authoritative for storage/arithmetic, this never round-trips back
 * into a calculation — see docs/pricing.md.
 */
export function formatMoney(value: string, currencyCode: string, decimalPlaces = 2): string {
  const num = Number(value);
  const amount = Number.isNaN(num)
    ? value
    : num.toLocaleString('es-AR', { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces });
  return `${currencyCode} ${amount}`;
}

/**
 * The same number `formatMoney` prints, without the currency code —
 * formatAmount('18500') -> "18.500,00".
 *
 * For places that state the currency once somewhere else, such as a
 * dashboard card whose label already says (ARS). Repeating the code inside
 * a large figure costs about 45px, which is what pushed "ARS 305.500,00"
 * past the edge of its card. Never use this where the currency is not
 * already unambiguous on screen.
 */
export function formatAmount(value: string, decimalPlaces = 2): string {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

/** Counts the fractional digits of a numeric string (e.g. "1.250" -> 3, "5" -> 0). */
export function countDecimalPlaces(value: string): number {
  const parts = value.split('.');
  return parts.length > 1 ? parts[1].length : 0;
}

/** True when `value` has more fractional digits than `decimalPlaces` allows — see docs/inventory.md (UnitOfMeasure.decimalPlaces). */
export function exceedsDecimalPrecision(value: string, decimalPlaces: number): boolean {
  return countDecimalPlaces(value) > decimalPlaces;
}

/**
 * Exact decimal-string arithmetic via BigInt fixed-point scaling — no
 * floating point, no `Prisma.Decimal` dependency (this package has no
 * Prisma dependency and stays that way). Used where authoritative money
 * arithmetic is needed client-side and a live server round-trip isn't —
 * e.g. POS's cash-received/change math, see docs/pos.md. Prefer
 * `Prisma.Decimal` directly wherever the code already runs against
 * `@prisma/client` (backend services) — these two helpers exist
 * specifically for the frontend, which cannot import it.
 */
function toScaledBigInt(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const digits = (intPart || '0') + fracPart.padEnd(scale, '0');
  const magnitude = BigInt(digits === '' ? '0' : digits);
  return negative ? -magnitude : magnitude;
}

function fromScaledBigInt(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale) || '0';
  const fracPart = scale > 0 ? digits.slice(digits.length - scale) : '';
  const sign = negative ? '-' : '';
  return scale > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/** Compares two decimal strings exactly: -1 if a<b, 0 if equal, 1 if a>b. Never `Number()`. */
export function compareDecimalStrings(a: string, b: string): number {
  const scale = Math.max(countDecimalPlaces(a), countDecimalPlaces(b));
  const scaledA = toScaledBigInt(a, scale);
  const scaledB = toScaledBigInt(b, scale);
  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}

/** Exact `a + b` as a decimal string, at the finer of the two inputs' precision. Never `Number()`. */
export function addDecimalStrings(a: string, b: string): string {
  const scale = Math.max(countDecimalPlaces(a), countDecimalPlaces(b));
  const result = toScaledBigInt(a, scale) + toScaledBigInt(b, scale);
  return fromScaledBigInt(result, scale);
}

/**
 * Exact sum of a list of decimal strings; `'0'` for an empty list.
 *
 * Folded through `addDecimalStrings` rather than accumulated as numbers,
 * for the same reason the rest of this block exists: a running total of
 * money shown next to the amount it has to match cannot be allowed to drift
 * by a cent because of binary floating point.
 */
export function sumDecimalStrings(values: string[]): string {
  return values.reduce((total, value) => addDecimalStrings(total, value), '0');
}

/** Exact `a - b` as a decimal string, at the finer of the two inputs' precision. Never `Number()`. */
export function subtractDecimalStrings(a: string, b: string): string {
  const scale = Math.max(countDecimalPlaces(a), countDecimalPlaces(b));
  const result = toScaledBigInt(a, scale) - toScaledBigInt(b, scale);
  return fromScaledBigInt(result, scale);
}
