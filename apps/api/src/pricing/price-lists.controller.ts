import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  createPriceListSchema,
  updatePriceListSchema,
  priceListItemsQuerySchema,
  setPriceSchema,
  setPricesBatchSchema,
  bulkAdjustSchema,
  priceHistoryQuerySchema,
  priceListHistoryQuerySchema,
  priceExportQuerySchema,
  type CreatePriceListInput,
  type UpdatePriceListInput,
  type PriceListsResponse,
  type PriceListDetailResponse,
  type PriceListItemsQuery,
  type PriceListItemsResponse,
  type SetPriceInput,
  type SetPriceResponse,
  type SetPricesBatchInput,
  type SetPricesBatchResponse,
  type BulkAdjustInput,
  type BulkAdjustPreviewResponse,
  type BulkAdjustResponse,
  type PriceHistoryQuery,
  type PriceHistoryResponse,
  type PriceListHistoryQuery,
  type AuditEntityHistoryResponse,
  type PriceExportQuery,
  type PriceImportPreviewResponse,
  type PriceImportResultResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PriceListsService } from './price-lists.service';
import { PriceImportService } from './price-import.service';
import { PricingService } from './pricing.service';

/**
 * 20 MB. The real Tango export in hand is 300 KB for 6.616 rows, so this
 * leaves two orders of magnitude of headroom while still refusing something
 * that was never a price list.
 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Accepts the upload into memory and caps its size.
 *
 * Memory rather than disk: the file is parsed once and discarded, so writing
 * it to a temp directory would only add a file to clean up and a path to get
 * wrong. The MIME check is a courtesy, not a guard — browsers lie about it
 * and the real validation is that ExcelJS can open the bytes.
 */
const uploadPipe = new ParseFilePipeBuilder()
  .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES })
  .build({ fileIsRequired: true });

@Controller('pricing/lists')
export class PriceListsController {
  constructor(
    private readonly priceListsService: PriceListsService,
    private readonly pricingService: PricingService,
    private readonly priceImportService: PriceImportService,
  ) {}

  /**
   * The price-edit workbook for whatever the screen is showing.
   *
   * Reads with `pricing.prices.read` — producing a file of prices someone
   * can already see on screen is not itself a write.
   */
  @RequirePermissions('pricing.prices.read')
  @Get(':id/export')
  async exportPrices(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(priceExportQuerySchema))
    query: PriceExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { fileName, buffer } = await this.priceImportService.exportPrices(
      ctx.companyId,
      id,
      query,
    );
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    // Named explicitly so the browser can read it cross-origin — the SPA is
    // served from a different port and would otherwise fall back to a
    // generic download name.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  }

  /**
   * Both import flows are preview-then-apply, as two calls with the same
   * file rather than one call holding server-side state between them. The
   * browser already has the file, so re-sending it is cheaper than a
   * staging table and cannot go stale or leak.
   */
  @RequirePermissions('pricing.prices.bulk_update')
  @Post(':id/import/tango/preview')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async previewTangoImport(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @UploadedFile(uploadPipe) file: Express.Multer.File,
  ): Promise<PriceImportPreviewResponse> {
    const preview = await this.priceImportService.previewTango(
      ctx,
      id,
      file.buffer,
    );
    return { preview };
  }

  @RequirePermissions('pricing.prices.bulk_update')
  @Post(':id/import/tango')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async applyTangoImport(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @UploadedFile(uploadPipe) file: Express.Multer.File,
    @Body('reason') reason?: string,
  ): Promise<PriceImportResultResponse> {
    return this.priceImportService.applyTango(ctx, id, file.buffer, reason);
  }

  @RequirePermissions('pricing.prices.bulk_update')
  @Post(':id/import/prices/preview')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async previewPriceImport(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @UploadedFile(uploadPipe) file: Express.Multer.File,
  ): Promise<PriceImportPreviewResponse> {
    const preview = await this.priceImportService.previewPriceWorkbook(
      ctx,
      id,
      file.buffer,
    );
    return { preview };
  }

  @RequirePermissions('pricing.prices.bulk_update')
  @Post(':id/import/prices')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async applyPriceImport(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @UploadedFile(uploadPipe) file: Express.Multer.File,
    @Body('reason') reason?: string,
  ): Promise<PriceImportResultResponse> {
    return this.priceImportService.applyPriceWorkbook(
      ctx,
      id,
      file.buffer,
      reason,
    );
  }

  @RequirePermissions('pricing.lists.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<PriceListsResponse> {
    const priceLists = await this.priceListsService.list(ctx.companyId);
    return { priceLists };
  }

  @RequirePermissions('pricing.lists.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.getById(ctx.companyId, id);
    return { priceList };
  }

  @RequirePermissions('pricing.lists.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createPriceListSchema))
    body: CreatePriceListInput,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.create(ctx, body);
    return { priceList };
  }

  @RequirePermissions('pricing.lists.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePriceListSchema))
    body: UpdatePriceListInput,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.update(ctx, id, body);
    return { priceList };
  }

  @RequirePermissions('pricing.lists.deactivate')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.deactivate(ctx, id);
    return { priceList };
  }

  @RequirePermissions('pricing.lists.deactivate')
  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.reactivate(ctx, id);
    return { priceList };
  }

  /** Administrative history (created/updated/deactivated/default changed/...) — distinct from the per-variant commercial price history below. */
  @RequirePermissions('pricing.lists.read')
  @Get(':id/history')
  history(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(priceListHistoryQuerySchema))
    query: PriceListHistoryQuery,
  ): Promise<AuditEntityHistoryResponse> {
    return this.priceListsService.getHistory(ctx.companyId, id, query);
  }

  @RequirePermissions('pricing.lists.read')
  @Get(':id/items')
  listItems(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(priceListItemsQuerySchema))
    query: PriceListItemsQuery,
  ): Promise<PriceListItemsResponse> {
    return this.priceListsService.listItems(ctx.companyId, id, query);
  }

  @RequirePermissions('pricing.prices.update')
  @Put(':priceListId/products/:variantId')
  async setPrice(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('priceListId') priceListId: string,
    @Param('variantId') variantId: string,
    @Body(new ZodValidationPipe(setPriceSchema)) body: SetPriceInput,
  ): Promise<SetPriceResponse> {
    const result = await this.pricingService.setPrice(
      ctx,
      priceListId,
      variantId,
      body,
    );
    return { result };
  }

  @RequirePermissions('pricing.prices.update')
  @Put(':priceListId/prices')
  async setPrices(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('priceListId') priceListId: string,
    @Body(new ZodValidationPipe(setPricesBatchSchema))
    body: SetPricesBatchInput,
  ): Promise<SetPricesBatchResponse> {
    const results = await this.pricingService.setPrices(ctx, priceListId, body);
    return { results };
  }

  @RequirePermissions('pricing.prices.bulk_update')
  @Post(':id/bulk-adjust/preview')
  @HttpCode(200)
  previewBulkAdjust(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bulkAdjustSchema)) body: BulkAdjustInput,
  ): Promise<BulkAdjustPreviewResponse> {
    return this.pricingService.previewBulkAdjust(ctx.companyId, id, body);
  }

  @RequirePermissions('pricing.prices.bulk_update')
  @Post(':id/bulk-adjust')
  confirmBulkAdjust(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bulkAdjustSchema)) body: BulkAdjustInput,
  ): Promise<BulkAdjustResponse> {
    return this.pricingService.confirmBulkAdjust(ctx, id, body);
  }

  @RequirePermissions('pricing.prices.read')
  @Get(':listId/products/:variantId/history')
  getHistory(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('listId') listId: string,
    @Param('variantId') variantId: string,
    @Query(new ZodValidationPipe(priceHistoryQuerySchema))
    query: PriceHistoryQuery,
  ): Promise<PriceHistoryResponse> {
    return this.pricingService.getPriceHistory(
      ctx.companyId,
      listId,
      variantId,
      query,
    );
  }
}
