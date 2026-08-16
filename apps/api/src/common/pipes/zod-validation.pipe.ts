import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates the request body against a Zod schema. Chosen over
 * class-validator so the same schema can be shared verbatim with the
 * frontend (see @erp/shared) — one source of truth for validation rules
 * like the password policy.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    // No body sent at all (e.g. a POST with no JSON body) parses to
    // `undefined`, not `{}` — for an all-optional schema like
    // confirmSaleSchema those must validate identically, so treat an
    // absent body the same as an empty one rather than failing "Required".
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      // Spread (not nest) — AllExceptionsFilter already lifts every key
      // besides `message` into the response's `details` object, so
      // nesting here would double-wrap it as `details.details`.
      throw new BadRequestException({
        message: 'Validation failed',
        ...result.error.flatten(),
      });
    }
    return result.data;
  }
}
