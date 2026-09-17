import { z } from 'zod';
import {
  TreasuryAccountType,
  TreasuryMovementType,
  TreasuryTransferStatus,
} from './enums';
import { moneySchema } from './decimal';
import type { PaginationMeta } from './api';

/**
 * Treasury — cash boxes, bank accounts and the movement ledger. See
 * docs/treasury.md.
 *
 * Money amounts cross the wire as decimal STRINGS, never numbers, for
 * the same reason they are `Prisma.Decimal` in the database: a balance
 * that round-trips through a JavaScript float is a balance that can
 * drift. Every consumer must treat them as strings and use the helpers
 * in `decimal.ts` to do arithmetic on them.
 */

const accountTypeValues = Object.values(TreasuryAccountType) as [
  TreasuryAccountType,
  ...TreasuryAccountType[],
];

const movementTypeValues = Object.values(TreasuryMovementType) as [
  TreasuryMovementType,
  ...TreasuryMovementType[],
];

const codeSchema = z
  .string()
  .trim()
  .min(1, 'El código es obligatorio.')
  .max(32, 'El código no puede superar los 32 caracteres.');

const nameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre es obligatorio.')
  .max(120, 'El nombre no puede superar los 120 caracteres.');

/** Absent or empty both mean "not given" — the right reading on creation. */
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

/**
 * Absent means "leave it alone"; empty or null mean "clear it". Without
 * the distinction an optional field can be set once and never removed.
 */
const clearableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

export const createTreasuryAccountSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    type: z.enum(accountTypeValues),
    currencyId: z.string().uuid('Elegí una moneda.'),
    branchId: z.string().uuid().optional(),
    allowsNegativeBalance: z.boolean().optional().default(false),
    bankName: optionalText(120),
    accountNumber: optionalText(64),
    cbu: optionalText(32),
    alias: optionalText(64),
    notes: optionalText(500),
  })
  .superRefine((value, ctx) => {
    // The server rejects this too — this is the early, friendly version.
    // A cash box that "allows negative" is not a configuration choice,
    // it is a contradiction.
    if (value.type === TreasuryAccountType.CASH_BOX && value.allowsNegativeBalance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Una caja no puede quedar en negativo.',
        path: ['allowsNegativeBalance'],
      });
    }
  });
export type CreateTreasuryAccountInput = z.infer<typeof createTreasuryAccountSchema>;

/**
 * `type` and `currencyId` are absent on purpose: both change what every
 * existing movement on the account means. Turning a peso cash box into a
 * dollar bank account would silently reinterpret its whole history.
 * Retire the account and open another one.
 *
 * The text fields are `clearableText`, not `optionalText`: on creation an
 * empty string sensibly means "not given", but on an edit it means "take
 * what is there away" — and collapsing the two would make a wrong CBU
 * impossible to remove, only to overwrite.
 */
export const updateTreasuryAccountSchema = z.object({
  name: nameSchema.optional(),
  branchId: z.string().uuid().nullable().optional(),
  allowsNegativeBalance: z.boolean().optional(),
  bankName: clearableText(120),
  accountNumber: clearableText(64),
  cbu: clearableText(32),
  alias: clearableText(64),
  notes: clearableText(500),
  active: z.boolean().optional(),
});
export type UpdateTreasuryAccountInput = z.infer<typeof updateTreasuryAccountSchema>;

/**
 * Signed, unlike `moneySchema`, which rejects every negative.
 *
 * A bank account can genuinely be overdrawn on the day the module is
 * loaded, and refusing to record that would force the operator to lie
 * about the starting position. Whether a given account may actually GO
 * negative is the server's call — a cash box never can — so this only
 * decides the shape, not the policy.
 */
const openingAmountSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^-?\d+(\.\d+)?$/.test(value), {
    message: 'Debe ser un número válido.',
  })
  .refine((value) => Number(value) !== 0, {
    message: 'El saldo de apertura no puede ser cero.',
  });

/**
 * What was already in the account the day it was loaded into the system.
 * It is a movement, not a column, so the ledger explains every peso of
 * the balance including the first one.
 */
export const setTreasuryOpeningBalanceSchema = z.object({
  amount: openingAmountSchema,
  occurredAt: z.string().datetime({ offset: true }).optional(),
  notes: optionalText(500),
});
export type SetTreasuryOpeningBalanceInput = z.infer<
  typeof setTreasuryOpeningBalanceSchema
>;

export interface TreasuryAccountDto {
  id: string;
  code: string;
  name: string;
  type: TreasuryAccountType;
  currencyId: string;
  currencyCode: string;
  currencySymbol: string;
  branchId: string | null;
  branchName: string | null;
  allowsNegativeBalance: boolean;
  bankName: string | null;
  accountNumber: string | null;
  cbu: string | null;
  alias: string | null;
  notes: string | null;
  active: boolean;
  /** Decimal string. Projected from the ledger — see docs/treasury.md. */
  balance: string;
}

export interface TreasuryMovementDto {
  id: string;
  treasuryAccountId: string;
  movementType: TreasuryMovementType;
  /** Decimal string, signed: positive money in, negative money out. */
  amount: string;
  occurredAt: string;
  sourceType: string;
  sourceId: string;
  description: string | null;
  notes: string | null;
  reversalOfId: string | null;
  createdAt: string;
}

/** One statement row: a movement plus the balance after it. */
export interface TreasuryStatementRowDto extends TreasuryMovementDto {
  /** Decimal string — the account's balance once this movement applied. */
  runningBalance: string;
}

export interface TreasuryAccountsResponse {
  accounts: TreasuryAccountDto[];
}

export interface TreasuryAccountDetailResponse {
  account: TreasuryAccountDto;
}

export interface TreasuryStatementResponse {
  account: TreasuryAccountDto;
  rows: TreasuryStatementRowDto[];
  pagination: PaginationMeta;
  /**
   * True while POS sales can reach this account's real-world drawer
   * without reaching this ledger — see docs/treasury.md's "Deliberately
   * not wired" section. The UI must say so next to the balance rather
   * than present a number it knows may be short.
   */
  excludesPosSales: boolean;
}

export const treasuryStatementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  movementType: z.enum(movementTypeValues).optional(),
});
export type TreasuryStatementQuery = z.infer<typeof treasuryStatementQuerySchema>;

export const treasuryAccountsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional().default(false),
  type: z.enum(accountTypeValues).optional(),
});
export type TreasuryAccountsQuery = z.infer<typeof treasuryAccountsQuerySchema>;

// ---------------------------------------------------------------------
// Transfers between two of the company's own accounts
// ---------------------------------------------------------------------

const transferStatusValues = Object.values(TreasuryTransferStatus) as [
  TreasuryTransferStatus,
  ...TreasuryTransferStatus[],
];

const transferAmountSchema = moneySchema.refine((v) => Number(v) > 0, {
  message: 'El importe debe ser mayor a 0.',
});

/**
 * The direction lives in the two movements the confirmation writes, not
 * in the sign of this amount — so it is always positive and a negative
 * transfer is a validation error rather than a backwards one.
 */
export const createTreasuryTransferSchema = z
  .object({
    sourceAccountId: z.string().uuid('Elegí la cuenta de origen.'),
    destinationAccountId: z.string().uuid('Elegí la cuenta de destino.'),
    amount: transferAmountSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
    notes: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (value.sourceAccountId === value.destinationAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El origen y el destino tienen que ser cuentas distintas.',
        path: ['destinationAccountId'],
      });
    }
  });
export type CreateTreasuryTransferInput = z.infer<typeof createTreasuryTransferSchema>;

/** Only while DRAFT. A confirmed transfer is history — anular y rehacer. */
export const updateTreasuryTransferSchema = z
  .object({
    sourceAccountId: z.string().uuid().optional(),
    destinationAccountId: z.string().uuid().optional(),
    amount: transferAmountSchema.optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    notes: clearableText(500),
  })
  .superRefine((value, ctx) => {
    if (
      value.sourceAccountId &&
      value.destinationAccountId &&
      value.sourceAccountId === value.destinationAccountId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El origen y el destino tienen que ser cuentas distintas.',
        path: ['destinationAccountId'],
      });
    }
  });
export type UpdateTreasuryTransferInput = z.infer<typeof updateTreasuryTransferSchema>;

export interface TreasuryTransferDto {
  id: string;
  number: string;
  status: TreasuryTransferStatus;
  sourceAccountId: string;
  sourceAccountName: string;
  destinationAccountId: string;
  destinationAccountName: string;
  currencyId: string;
  currencyCode: string;
  /** Decimal string, always positive. */
  amount: string;
  occurredAt: string;
  notes: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface TreasuryTransfersResponse {
  transfers: TreasuryTransferDto[];
  pagination: PaginationMeta;
}

export interface TreasuryTransferDetailResponse {
  transfer: TreasuryTransferDto;
}

export const treasuryTransfersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  status: z.enum(transferStatusValues).optional(),
  accountId: z.string().uuid().optional(),
});
export type TreasuryTransfersQuery = z.infer<typeof treasuryTransfersQuerySchema>;
