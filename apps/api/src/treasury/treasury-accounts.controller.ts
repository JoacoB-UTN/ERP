import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createTreasuryAccountSchema,
  updateTreasuryAccountSchema,
  setTreasuryOpeningBalanceSchema,
  treasuryAccountsQuerySchema,
  treasuryStatementQuerySchema,
  type CreateTreasuryAccountInput,
  type UpdateTreasuryAccountInput,
  type SetTreasuryOpeningBalanceInput,
  type TreasuryAccountsQuery,
  type TreasuryStatementQuery,
  type TreasuryAccountsResponse,
  type TreasuryAccountDetailResponse,
  type TreasuryStatementResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TreasuryAccountsService } from './treasury-accounts.service';

@Controller('treasury/accounts')
export class TreasuryAccountsController {
  constructor(private readonly accounts: TreasuryAccountsService) {}

  @RequirePermissions('treasury.accounts.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(treasuryAccountsQuerySchema))
    query: TreasuryAccountsQuery,
  ): Promise<TreasuryAccountsResponse> {
    const accounts = await this.accounts.list(ctx.companyId, query);
    return { accounts };
  }

  @RequirePermissions('treasury.accounts.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<TreasuryAccountDetailResponse> {
    const account = await this.accounts.getById(ctx.companyId, id);
    return { account };
  }

  /**
   * The ledger read surface, and it needs **both** codes.
   *
   * `treasury.movements.read` is the ledger itself. But the response also
   * carries the account — balance, bank name, account number, CBU, alias
   * — so gating on the ledger code alone handed every one of those to a
   * caller who was never granted `treasury.accounts.read`. The two codes
   * are still separate in the other direction, which is the split that
   * matters: seeing that a cash box exists does not let you read every
   * peso that passed through it.
   */
  @RequirePermissions('treasury.movements.read', 'treasury.accounts.read')
  @Get(':id/statement')
  async getStatement(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(treasuryStatementQuerySchema))
    query: TreasuryStatementQuery,
  ): Promise<TreasuryStatementResponse> {
    return this.accounts.getStatement(ctx.companyId, id, query);
  }

  @RequirePermissions('treasury.accounts.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createTreasuryAccountSchema))
    body: CreateTreasuryAccountInput,
  ): Promise<TreasuryAccountDetailResponse> {
    const account = await this.accounts.create(ctx, body);
    return { account };
  }

  @RequirePermissions('treasury.accounts.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTreasuryAccountSchema))
    body: UpdateTreasuryAccountInput,
  ): Promise<TreasuryAccountDetailResponse> {
    const account = await this.accounts.update(ctx, id, body);
    return { account };
  }

  /**
   * Writes a movement, so it needs the movement-writing permission
   * rather than the account-editing one: declaring what is in a drawer
   * is a treasury operation, not master-data maintenance.
   */
  @RequirePermissions('treasury.movements.create')
  @Post(':id/opening-balance')
  async setOpeningBalance(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setTreasuryOpeningBalanceSchema))
    body: SetTreasuryOpeningBalanceInput,
  ): Promise<TreasuryAccountDetailResponse> {
    const account = await this.accounts.setOpeningBalance(ctx, id, body);
    return { account };
  }
}
