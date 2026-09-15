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
   * The ledger read surface. Gated by `treasury.movements.read` and not
   * by `treasury.accounts.read`: knowing that a cash box exists and
   * reading every peso that passed through it are different trust
   * levels — the same split `docs/current-accounts.md` makes between
   * seeing a customer and seeing their balance.
   */
  @RequirePermissions('treasury.movements.read')
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
