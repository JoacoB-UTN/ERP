import { Injectable } from '@nestjs/common';
import {
  PRICE_WORKBOOK_HEADERS,
  priceImportRowStatusValues,
  type PriceExportQuery,
  type PriceImportPreviewDto,
  type PriceImportResultDto,
  type PriceImportRowDto,
  type PriceImportRowStatus,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { RequestContext } from '../company-context/types';
import { PricingService } from './pricing.service';
import { PriceListsService } from './price-lists.service';
import {
  PriceFileUnreadableException,
  PriceFileNothingToApplyException,
} from './pricing.exceptions';
import {
  buildWorkbook,
  cellText,
  normalizeCode,
  normalizeHeader,
  parseDecimal,
  readSheetTable,
  type SheetTable,
} from './workbook';

/** Tango's own column names, as they appear in its price-list export. */
const TANGO_HEADERS = {
  code: 'Cód. Artículo',
  description: 'Descripción',
  extraDescription: 'Desc. Adicional',
  barcode: 'Código de Barras',
  price: 'Precio',
  sourceListCode: 'Cód. Lista de Precios',
} as const;

/**
 * How many rows of EACH status the preview sends back. The counts are always
 * complete.
 *
 * Per status, not a flat cap over the whole file: a first run against a fresh
 * catalogue produced 6.614 not-found rows and 2 that would update, and a flat
 * worst-first cap of 200 showed only not-found ones — the two rows that were
 * actually going to change were invisible in a preview whose entire job is to
 * show what is going to change.
 */
const SAMPLE_PER_STATUS = 40;

/** Worst first, so a truncated sample shows the problems and not the successes. */
const STATUS_PRIORITY: Record<PriceImportRowStatus, number> = {
  AMBIGUOUS: 0,
  INVALID_PRICE: 1,
  NOT_FOUND: 2,
  WILL_UPDATE: 3,
  UNCHANGED: 4,
};

interface ParsedRow {
  rowNumber: number;
  code: string | null;
  barcode: string | null;
  description: string | null;
  price: string | null;
  sourceListCode: string | null;
}

interface ResolvedRow extends ParsedRow {
  status: PriceImportRowStatus;
  variantId: string | null;
  currentPrice: string | null;
  productName: string | null;
}

/**
 * Getting prices in and out of the system as spreadsheets.
 *
 * Two flows, one engine. The first reads a Tango price-list export as-is, so
 * a customer arriving from Tango does not have to reshape their data before
 * it is useful. The second exports what is on screen, lets someone edit the
 * prices in Excel, and reads the same file back — the everyday bulk edit.
 *
 * Both END at `PricingService.setPrices`. That is deliberate and not
 * negotiable: the rules that close a previous validity range, write the
 * PriceHistory row and refuse an overlapping one all live in
 * `applyPriceChange`, and an importer that wrote `PriceListItem` rows itself
 * would quietly produce price histories no other path can produce (see
 * docs/pricing.md).
 *
 * Every upload is previewed before it is applied, and the preview is
 * computed by the same code that does the applying — so what the person
 * approves is what runs, not a separate estimate of it.
 */
@Injectable()
export class PriceImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly priceListsService: PriceListsService,
  ) {}

  // ---------- Tango import ----------

  async previewTango(
    ctx: RequestContext,
    priceListId: string,
    file: Buffer,
  ): Promise<PriceImportPreviewDto> {
    const rows = await this.parseTango(file);
    const resolved = await this.resolve(ctx.companyId, priceListId, rows);
    return this.toPreview(resolved, rows.length);
  }

  async applyTango(
    ctx: RequestContext,
    priceListId: string,
    file: Buffer,
    reason?: string,
  ): Promise<{ preview: PriceImportPreviewDto; result: PriceImportResultDto }> {
    const rows = await this.parseTango(file);
    const resolved = await this.resolve(ctx.companyId, priceListId, rows);
    const result = await this.apply(
      ctx,
      priceListId,
      resolved,
      reason ?? 'Importación desde Tango',
    );
    return { preview: this.toPreview(resolved, rows.length), result };
  }

  private async parseTango(file: Buffer): Promise<ParsedRow[]> {
    const table = await this.read(file, [
      TANGO_HEADERS.code,
      TANGO_HEADERS.price,
    ]);
    const col = (header: string) => table.columns.get(normalizeHeader(header));
    const cCode = col(TANGO_HEADERS.code);
    const cDesc = col(TANGO_HEADERS.description);
    const cExtra = col(TANGO_HEADERS.extraDescription);
    const cBar = col(TANGO_HEADERS.barcode);
    const cPrice = col(TANGO_HEADERS.price);
    const cList = col(TANGO_HEADERS.sourceListCode);

    return table.rows.map((row) => {
      const at = (index: number | undefined) =>
        index === undefined ? '' : cellText(row.cells[index]);
      const description = [at(cDesc), at(cExtra)].filter(Boolean).join(' — ');
      return {
        rowNumber: row.rowNumber,
        code: at(cCode) || null,
        barcode: at(cBar) || null,
        description: description || null,
        price: cPrice === undefined ? null : parseDecimal(row.cells[cPrice]),
        sourceListCode: at(cList) || null,
      };
    });
  }

  // ---------- Price-edit round trip ----------

  async exportPrices(
    companyId: string,
    priceListId: string,
    query: PriceExportQuery,
  ): Promise<{ fileName: string; buffer: Buffer }> {
    const list = await this.pricingService.loadPriceList(companyId, priceListId);

    // Reuses the screen's own listing so the file always contains exactly
    // what the filters show — a second query with its own idea of the
    // filters would drift the moment either changed.
    const items = await this.priceListsService.listItems(companyId, priceListId, {
      search: query.search,
      categoryId: query.categoryId,
      lineId: query.lineId,
      status: query.status,
      hasPrice: query.hasPrice,
      page: 1,
      pageSize: EXPORT_PAGE_SIZE,
    });

    const selected = query.variantIds ? new Set(query.variantIds) : null;
    const rows = items.items
      .filter((i) => !selected || selected.has(i.variantId))
      .map((i) => [
        i.variantId,
        i.productCode,
        i.sku ?? '',
        i.productName,
        i.variantName ?? '',
        i.price === null ? null : Number(i.price),
        // Deliberately blank. Pre-filling it with the current price would
        // mean an untouched file re-applies every price on re-import,
        // stamping a new effective date on rows nobody meant to change.
        null,
      ]);

    const buffer = await buildWorkbook({
      sheetName: 'Precios',
      columns: [
        { header: PRICE_WORKBOOK_HEADERS.variantId, width: 38, readOnly: true },
        { header: PRICE_WORKBOOK_HEADERS.productCode, width: 14, readOnly: true },
        { header: PRICE_WORKBOOK_HEADERS.sku, width: 18, readOnly: true },
        { header: PRICE_WORKBOOK_HEADERS.productName, width: 42, readOnly: true },
        { header: PRICE_WORKBOOK_HEADERS.variantName, width: 22, readOnly: true },
        { header: PRICE_WORKBOOK_HEADERS.currentPrice, width: 16, readOnly: true, numeric: true },
        { header: PRICE_WORKBOOK_HEADERS.newPrice, width: 16, numeric: true },
      ],
      rows,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const safeName = list.code.replace(/[^A-Za-z0-9_-]+/g, '-');
    return { fileName: `precios-${safeName}-${stamp}.xlsx`, buffer };
  }

  async previewPriceWorkbook(
    ctx: RequestContext,
    priceListId: string,
    file: Buffer,
  ): Promise<PriceImportPreviewDto> {
    const rows = await this.parsePriceWorkbook(file);
    const resolved = await this.resolve(ctx.companyId, priceListId, rows);
    return this.toPreview(resolved, rows.length);
  }

  async applyPriceWorkbook(
    ctx: RequestContext,
    priceListId: string,
    file: Buffer,
    reason?: string,
  ): Promise<{ preview: PriceImportPreviewDto; result: PriceImportResultDto }> {
    const rows = await this.parsePriceWorkbook(file);
    const resolved = await this.resolve(ctx.companyId, priceListId, rows);
    const result = await this.apply(
      ctx,
      priceListId,
      resolved,
      reason ?? 'Actualización masiva desde Excel',
    );
    return { preview: this.toPreview(resolved, rows.length), result };
  }

  /**
   * Reads back the workbook this service wrote.
   *
   * A row with an empty "Precio nuevo" is dropped entirely rather than
   * reported: the export leaves that column blank on purpose, so in a file
   * where someone edited twenty of six thousand rows, the other 5.980 are
   * not omissions to flag — they are the answer "leave these alone". Only
   * the edited rows reach the preview.
   */
  private async parsePriceWorkbook(file: Buffer): Promise<ParsedRow[]> {
    const table = await this.read(file, [
      PRICE_WORKBOOK_HEADERS.variantId,
      PRICE_WORKBOOK_HEADERS.newPrice,
    ]);
    const col = (header: string) => table.columns.get(normalizeHeader(header));
    const cId = col(PRICE_WORKBOOK_HEADERS.variantId);
    const cCode = col(PRICE_WORKBOOK_HEADERS.productCode);
    const cName = col(PRICE_WORKBOOK_HEADERS.productName);
    const cNew = col(PRICE_WORKBOOK_HEADERS.newPrice);

    const out: ParsedRow[] = [];
    for (const row of table.rows) {
      const at = (index: number | undefined) =>
        index === undefined ? '' : cellText(row.cells[index]);
      const rawNew = cNew === undefined ? '' : cellText(row.cells[cNew]);
      if (!rawNew) continue;
      out.push({
        rowNumber: row.rowNumber,
        // The internal id is the match key here — not the code — because
        // this file came from us and carries it. `code` is only ever shown.
        code: at(cId) || null,
        barcode: null,
        description: [at(cCode), at(cName)].filter(Boolean).join(' — ') || null,
        price: parseDecimal(row.cells[cNew!]),
        sourceListCode: null,
      });
    }
    return out;
  }

  // ---------- Shared machinery ----------

  private async read(file: Buffer, requiredHeaders: string[]): Promise<SheetTable> {
    let table: SheetTable | null;
    try {
      table = await readSheetTable(file, requiredHeaders);
    } catch {
      // Anything ExcelJS refuses to open — a .xls, a CSV renamed, a corrupt
      // upload — reads to the user as the same problem: this is not a file
      // we can open.
      throw new PriceFileUnreadableException(requiredHeaders);
    }
    if (!table) throw new PriceFileUnreadableException(requiredHeaders);
    return table;
  }

  /**
   * Points every parsed row at a product variant, or explains why not.
   *
   * Matching is by internal id first (our own export), then barcode, then
   * code against `ProductVariant.sku`. Barcode outranks code because it is
   * the value least likely to have been retyped, and codes carry Tango's
   * padding; both are compared on a normalized key (see `normalizeCode`).
   *
   * Every lookup is one query for the whole file, not one per row — a
   * 6.600-row import would otherwise open 13.000 round trips before writing
   * anything.
   */
  private async resolve(
    companyId: string,
    priceListId: string,
    rows: ParsedRow[],
  ): Promise<ResolvedRow[]> {
    const codeKeys = new Set<string>();
    const barcodeKeys = new Set<string>();
    for (const r of rows) {
      if (r.code) codeKeys.add(normalizeCode(r.code));
      if (r.barcode) barcodeKeys.add(normalizeCode(r.barcode));
    }

    const variants = await this.prisma.productVariant.findMany({
      where: { product: { companyId } },
      select: {
        id: true,
        sku: true,
        name: true,
        active: true,
        product: { select: { name: true } },
        codes: { where: { active: true, type: 'BARCODE' }, select: { code: true } },
      },
    });

    // "Ambiguous" is a real outcome, not an error: two variants can legally
    // share a barcode in the data as it stands, and the import must say so
    // rather than pick one.
    const byId = new Map<string, (typeof variants)[number]>();
    const bySku = new Map<string, string[]>();
    const byBarcode = new Map<string, string[]>();
    const push = (map: Map<string, string[]>, key: string, id: string) => {
      const list = map.get(key);
      if (list) list.push(id);
      else map.set(key, [id]);
    };
    for (const v of variants) {
      byId.set(v.id, v);
      if (v.sku) push(bySku, normalizeCode(v.sku), v.id);
      for (const c of v.codes) push(byBarcode, normalizeCode(c.code), v.id);
    }

    const currentPrices = await this.currentPrices(companyId, priceListId);

    return rows.map((row) => {
      const base = {
        ...row,
        variantId: null as string | null,
        currentPrice: null as string | null,
        productName: null as string | null,
      };

      const idHit = row.code ? byId.get(row.code) : undefined;
      let candidates: string[] | undefined;
      if (idHit) candidates = [idHit.id];
      else if (row.barcode) candidates = byBarcode.get(normalizeCode(row.barcode));
      if (!candidates && row.code) candidates = bySku.get(normalizeCode(row.code));

      if (!candidates || candidates.length === 0) {
        return { ...base, status: 'NOT_FOUND' as const };
      }
      if (candidates.length > 1) {
        return { ...base, status: 'AMBIGUOUS' as const };
      }

      const variant = byId.get(candidates[0])!;
      const productName = [variant.product.name, variant.name]
        .filter(Boolean)
        .join(' — ');
      const currentPrice = currentPrices.get(variant.id) ?? null;

      if (row.price === null) {
        return {
          ...base,
          status: 'INVALID_PRICE' as const,
          variantId: variant.id,
          currentPrice,
          productName,
        };
      }

      // Compared as Decimal, not as strings: "6099" and "6099.00" are the
      // same price, and a string compare would rewrite the whole list on
      // every import for no reason.
      const unchanged =
        currentPrice !== null &&
        new Prisma.Decimal(currentPrice).equals(new Prisma.Decimal(row.price));

      return {
        ...base,
        status: unchanged ? ('UNCHANGED' as const) : ('WILL_UPDATE' as const),
        variantId: variant.id,
        currentPrice,
        productName,
      };
    });
  }

  /** Today's active price per variant in this list, in one query. */
  private async currentPrices(
    companyId: string,
    priceListId: string,
  ): Promise<Map<string, string>> {
    const items = await this.prisma.priceListItem.findMany({
      where: {
        companyId,
        priceListId,
        active: true,
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { productVariantId: true, price: true },
    });
    const map = new Map<string, string>();
    // Ordered newest-first, so the first row seen for a variant is the one
    // in force; later ones are superseded.
    for (const item of items) {
      if (!map.has(item.productVariantId)) {
        map.set(item.productVariantId, item.price.toString());
      }
    }
    return map;
  }

  /**
   * Writes the rows that actually change, in chunks.
   *
   * Chunked rather than one transaction because `setPrices` does real
   * per-line work (closing the previous range, writing history) and a
   * six-thousand-line file in a single transaction would hold locks on the
   * whole price list for as long as it takes. Each chunk is still atomic, so
   * a failure part-way leaves whole chunks applied and the rest untouched —
   * and re-running the same file is safe, because the rows already applied
   * come back as UNCHANGED.
   */
  private async apply(
    ctx: RequestContext,
    priceListId: string,
    resolved: ResolvedRow[],
    reason: string,
  ): Promise<PriceImportResultDto> {
    const changes = resolved.filter(
      (r): r is ResolvedRow & { variantId: string; price: string } =>
        r.status === 'WILL_UPDATE' && r.variantId !== null && r.price !== null,
    );
    if (changes.length === 0) throw new PriceFileNothingToApplyException();

    const effectiveFrom = new Date();
    let applied = 0;
    for (let i = 0; i < changes.length; i += APPLY_CHUNK_SIZE) {
      const chunk = changes.slice(i, i + APPLY_CHUNK_SIZE);
      await this.pricingService.setPrices(ctx, priceListId, {
        effectiveFrom,
        reason,
        items: chunk.map((c) => ({ productVariantId: c.variantId, price: c.price })),
      });
      applied += chunk.length;
    }

    return {
      applied,
      skipped: resolved.length - applied,
      effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
    };
  }

  private toPreview(resolved: ResolvedRow[], fileRows: number): PriceImportPreviewDto {
    const counts = Object.fromEntries(
      priceImportRowStatusValues.map((s) => [s, 0]),
    ) as Record<PriceImportRowStatus, number>;
    const sourceListCodes = new Set<string>();
    for (const r of resolved) {
      counts[r.status] += 1;
      if (r.sourceListCode) sourceListCodes.add(r.sourceListCode);
    }

    const taken: ResolvedRow[] = [];
    let truncated = false;
    for (const status of [...priceImportRowStatusValues].sort(
      (a, b) => STATUS_PRIORITY[a] - STATUS_PRIORITY[b],
    )) {
      const ofStatus = resolved.filter((r) => r.status === status);
      taken.push(...ofStatus.slice(0, SAMPLE_PER_STATUS));
      if (ofStatus.length > SAMPLE_PER_STATUS) truncated = true;
    }

    const rows: PriceImportRowDto[] = taken.map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      code: r.code,
      barcode: r.barcode,
      description: r.description,
      price: r.price,
      currentPrice: r.currentPrice,
      productName: r.productName,
    }));

    return {
      fileRows,
      counts,
      rows,
      sampleTruncated: truncated,
      sourcePriceListCodes: [...sourceListCodes].sort(),
    };
  }
}

/**
 * One page big enough for a whole catalogue. The export is a deliberate,
 * user-initiated action over a list the screen already paginates, so the cap
 * is a guard against a runaway file rather than a paging strategy — a
 * catalogue past this size needs a different feature, not a bigger number.
 */
const EXPORT_PAGE_SIZE = 20000;

/**
 * Lines per transaction when applying. Small enough that no single
 * transaction holds the price list for long, large enough that a
 * six-thousand-row import is a few hundred round trips and not six thousand.
 */
const APPLY_CHUNK_SIZE = 200;
