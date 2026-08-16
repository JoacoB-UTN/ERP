import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base for every company/branch-context error. Carries an explicit `code`
 * distinct from its HTTP status (several of these share a status — e.g.
 * COMPANY_ACCESS_DENIED and COMPANY_INACTIVE are both 403) so clients can
 * branch on `error.code` instead of guessing from the status alone.
 * AllExceptionsFilter reads this `code` off the exception body — see there.
 */
export class CompanyContextException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ message, code }, status);
  }
}

export class CompanyContextRequiredException extends CompanyContextException {
  constructor() {
    super(
      HttpStatus.BAD_REQUEST,
      'COMPANY_CONTEXT_REQUIRED',
      'This request requires an active company context (X-Company-Id header).',
    );
  }
}

export class InvalidCompanyContextException extends CompanyContextException {
  constructor() {
    super(
      HttpStatus.BAD_REQUEST,
      'INVALID_COMPANY_CONTEXT',
      'X-Company-Id must be a valid identifier.',
    );
  }
}

/**
 * Thrown both when the company genuinely doesn't exist AND when the user
 * simply has no membership row for it (e.g. it belongs to another
 * tenant). Identical response in both cases — see CLAUDE.md's company
 * isolation rule: never let a response reveal whether a company the
 * caller can't access exists at all.
 */
export class CompanyAccessDeniedException extends CompanyContextException {
  constructor() {
    super(
      HttpStatus.FORBIDDEN,
      'COMPANY_ACCESS_DENIED',
      'You do not have access to this company.',
    );
  }
}

/** Only reachable once a membership row is confirmed to exist — safe to be specific. */
export class CompanyInactiveException extends CompanyContextException {
  constructor() {
    super(
      HttpStatus.FORBIDDEN,
      'COMPANY_INACTIVE',
      'This company is not currently active.',
    );
  }
}

export class BranchAccessInvalidException extends CompanyContextException {
  constructor() {
    super(
      HttpStatus.BAD_REQUEST,
      'BRANCH_ACCESS_INVALID',
      'X-Branch-Id is invalid, inactive, or does not belong to the active company.',
    );
  }
}
