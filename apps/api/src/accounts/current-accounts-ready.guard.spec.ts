import { ServiceUnavailableException } from '@nestjs/common';
import { CurrentAccountsReadyGuard } from './current-accounts-ready.guard';
import type {
  CurrentAccountsBackfillService,
  CurrentAccountsBackfillState,
} from './current-accounts-backfill.service';

describe('CurrentAccountsReadyGuard', () => {
  function build(state: CurrentAccountsBackfillState) {
    const refreshIfPending = jest.fn().mockResolvedValue(state);
    const backfill = { refreshIfPending };
    const guard = new CurrentAccountsReadyGuard(
      backfill as unknown as CurrentAccountsBackfillService,
    );
    return { guard, refreshIfPending };
  }

  it('lets the request through only when the ledger is loaded', async () => {
    const { guard } = build('complete');
    await expect(guard.canActivate()).resolves.toBe(true);
  });

  it.each<CurrentAccountsBackfillState>(['pending', 'running', 'failed'])(
    'refuses with 503 and a specific code while the backfill is %s',
    async (state) => {
      const { guard } = build(state);
      await expect(guard.canActivate()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      try {
        await guard.canActivate();
      } catch (error) {
        const body = (error as ServiceUnavailableException).getResponse() as {
          code: string;
          details: { backfill: string };
        };
        // A specific code, not the generic per-status one: a client has to be
        // able to tell "not loaded yet" from any other 503.
        expect(body.code).toBe('CURRENT_ACCOUNTS_NOT_READY');
        expect(body.details.backfill).toBe(state);
      }
    },
  );

  it('refuses when the backfill is disabled, rather than assuming the ledger is fine', async () => {
    // Turning the automatic load off moves the responsibility to an operator.
    // It does not load anything, and this gate must not imply that it did.
    const { guard } = build('disabled');
    await expect(guard.canActivate()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('asks the service to re-check a pending state instead of trusting it', async () => {
    // The instance that lost the advisory lock recorded `pending` and nothing
    // else would ever revisit it. Without this call it would refuse current
    // accounts for its whole life over a ledger that is already loaded.
    const { guard, refreshIfPending } = build('complete');
    await guard.canActivate();
    expect(refreshIfPending).toHaveBeenCalledTimes(1);
  });
});
