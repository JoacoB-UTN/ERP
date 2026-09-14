import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CurrentAccountsBackfillService } from './current-accounts-backfill.service';

/**
 * Readiness gate for every Current Accounts endpoint.
 *
 * A balance in this module is derived from the ledger, so a ledger that is
 * still missing its historical movements does not answer "wrong" in a way
 * anyone can see — it answers **zero**, confidently. An installation that
 * has just upgraded into the module would show every customer owing nothing,
 * and a screen that says "no debe nada" is indistinguishable from a screen
 * that says "we have not loaded the history yet".
 *
 * So until the backfill has established that nothing is outstanding, these
 * endpoints refuse rather than serve a number. 503 rather than 500 or an
 * empty list: the request is not wrong, the server is not ready to answer
 * it, and it will be shortly.
 *
 * `disabled` is refused too. Turning the automatic backfill off moves the
 * responsibility to an operator; it does not make the ledger correct, and
 * this gate must not imply that it did. An installation that runs the script
 * by hand and restarts gets a `complete` state on the next boot.
 */
@Injectable()
export class CurrentAccountsReadyGuard implements CanActivate {
  constructor(private readonly backfill: CurrentAccountsBackfillService) {}

  async canActivate(): Promise<boolean> {
    // `pending` is re-checked rather than trusted. An instance that lost the
    // advisory lock to a sibling on a LAN skipped its own pass and recorded
    // `pending` — correctly, at that moment — and nothing else would ever
    // revisit it, so that instance would refuse current accounts forever
    // while the ledger was in fact loaded. One cheap EXISTS per request,
    // only while pending, and never again once it resolves.
    const state = await this.backfill.refreshIfPending();
    if (state === 'complete') return true;

    // Flat { message, code, details } — the shape the global exception
    // filter reads. A nested envelope here is silently ignored and the
    // response falls back to the generic SERVICE_UNAVAILABLE.
    throw new ServiceUnavailableException({
      message:
        'Las cuentas corrientes todavía no están disponibles: falta cargar los movimientos históricos.',
      code: 'CURRENT_ACCOUNTS_NOT_READY',
      details: { backfill: state },
    });
  }
}
