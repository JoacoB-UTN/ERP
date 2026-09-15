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
  createTreasuryTransferSchema,
  updateTreasuryTransferSchema,
  treasuryTransfersQuerySchema,
  type CreateTreasuryTransferInput,
  type UpdateTreasuryTransferInput,
  type TreasuryTransfersQuery,
  type TreasuryTransfersResponse,
  type TreasuryTransferDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TreasuryTransfersService } from './treasury-transfers.service';

@Controller('treasury/transfers')
export class TreasuryTransfersController {
  constructor(private readonly transfers: TreasuryTransfersService) {}

  @RequirePermissions('treasury.transfers.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(treasuryTransfersQuerySchema))
    query: TreasuryTransfersQuery,
  ): Promise<TreasuryTransfersResponse> {
    return this.transfers.list(ctx.companyId, query);
  }

  @RequirePermissions('treasury.transfers.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<TreasuryTransferDetailResponse> {
    const transfer = await this.transfers.getById(ctx.companyId, id);
    return { transfer };
  }

  @RequirePermissions('treasury.transfers.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createTreasuryTransferSchema))
    body: CreateTreasuryTransferInput,
  ): Promise<TreasuryTransferDetailResponse> {
    const transfer = await this.transfers.create(ctx, body);
    return { transfer };
  }

  @RequirePermissions('treasury.transfers.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTreasuryTransferSchema))
    body: UpdateTreasuryTransferInput,
  ): Promise<TreasuryTransferDetailResponse> {
    const transfer = await this.transfers.update(ctx, id, body);
    return { transfer };
  }

  /** The only call that moves money. Separate permission for that reason. */
  @RequirePermissions('treasury.transfers.confirm')
  @Post(':id/confirm')
  async confirm(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<TreasuryTransferDetailResponse> {
    const transfer = await this.transfers.confirm(ctx, id);
    return { transfer };
  }

  @RequirePermissions('treasury.transfers.cancel')
  @Post(':id/cancel')
  async cancel(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<TreasuryTransferDetailResponse> {
    const transfer = await this.transfers.cancel(ctx, id);
    return { transfer };
  }
}
