import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type {
  Warehouse,
  ProductVariant,
  Product,
  UnitOfMeasure,
  StockMovement,
  StockReservation,
  InventoryBalance,
  MovementType,
} from '../generated/prisma/client';
import type {
  StockListQuery,
  StockListResponse,
  StockRowDto,
  ProductStockResponse,
  VariantStockResponse,
  InventoryLookupQuery,
  InventoryLookupResponse,
  InventoryLookupItem,
  MovementListQuery,
  MovementListResponse,
  StockMovementDto,
  CreateInitialBalanceInput,
  InitialBalanceResponse,
} from '@erp/shared';
import { exceedsDecimalPrecision } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import type { RequestContext } from '../company-context/types';
import { WarehouseNotFoundException } from '../warehouses/warehouses.exceptions';
import { ProductVariantNotFoundException } from '../products/products.exceptions';
import {
  InsufficientStockException,
  InsufficientAvailableStockException,
  ProductDoesNotTrackInventoryException,
  InitialBalanceAlreadyEstablishedException,
  InvalidQuantityPrecisionException,
  StockMovementNotFoundException,
} from './inventory.exceptions';

type VariantWithProduct = ProductVariant & {
  product: Product & { baseUnit: UnitOfMeasure };
};

const VARIANT_WITH_PRODUCT_INCLUDE = {
  product: { include: { baseUnit: true } },
} satisfies Prisma.ProductVariantInclude;

const ZERO = new Prisma.Decimal(0);

function toMovementDto(
  m: StockMovement & {
    warehouse: Warehouse;
    variant: ProductVariant & { product: Product };
  },
  createdByName: string | null,
): StockMovementDto {
  return {
    id: m.id,
    occurredAt: m.occurredAt.toISOString(),
    warehouse: {
      id: m.warehouse.id,
      code: m.warehouse.code,
      name: m.warehouse.name,
    },
    productId: m.variant.product.id,
    productCode: m.variant.product.code,
    productName: m.variant.product.name,
    variantId: m.variant.id,
    variantName: m.variant.name,
    sku: m.variant.sku,
    movementType: m.movementType,
    quantity: m.quantity.toString(),
    referenceType: m.referenceType,
    referenceId: m.referenceId,
    reason: m.reason,
    notes: m.notes,
    createdBy: m.createdBy ? { id: m.createdBy, name: createdByName } : null,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * The inventory ledger + rebuildable projection — see docs/inventory.md
 * and CLAUDE.md. StockMovement rows are the only authoritative source of
 * physical stock; InventoryBalance is updated atomically alongside every
 * movement/reservation change (same DB transaction) purely for fast
 * reads, and can always be reconstructed via rebuildInventoryBalances.
 *
 * Concurrency: every balance mutation goes through a single atomic
 * `upsert` with `{ increment: delta }` — Postgres serializes concurrent
 * UPDATEs to the same row, so the RETURNING value each caller sees is
 * always correctly post-serialized (no read-modify-write race). See
 * applyMovement / adjustReservedQuantity.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtimePublisher: RealtimePublisher,
  ) {}

  // ---------- Reads ----------

  async getBalance(
    companyId: string,
    warehouseId: string,
    productVariantId: string,
  ): Promise<{
    onHand: string;
    reserved: string;
    available: string;
    incoming: string;
  }> {
    const balance = await this.prisma.inventoryBalance.findUnique({
      where: {
        companyId_warehouseId_productVariantId: {
          companyId,
          warehouseId,
          productVariantId,
        },
      },
    });
    const onHand = balance?.onHand ?? ZERO;
    const reserved = balance?.reserved ?? ZERO;
    const incoming = balance?.incoming ?? ZERO;
    return {
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: onHand.sub(reserved).toString(),
      incoming: incoming.toString(),
    };
  }

  /**
   * Paginates over InventoryBalance rows — see docs/inventory.md's
   * documented decision. A variant that has never had a movement in any
   * warehouse has nothing to project yet and won't appear until an
   * initial balance or adjustment gives it one; this keeps the query a
   * clean, natively-paginated join instead of a variant×warehouse cross
   * product.
   */
  async listStock(
    companyId: string,
    query: StockListQuery,
  ): Promise<StockListResponse> {
    const where: Prisma.InventoryBalanceWhereInput = {
      companyId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.productId ? { variant: { productId: query.productId } } : {}),
      variant: {
        ...(query.productId ? { productId: query.productId } : {}),
        product: {
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.brandId ? { brandId: query.brandId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.search
            ? {
                OR: [
                  { code: { contains: query.search, mode: 'insensitive' } },
                  { name: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
    };

    const include = {
      warehouse: true,
      variant: { include: { product: true, codes: false } },
    } satisfies Prisma.InventoryBalanceInclude;

    if (query.belowMinimum) {
      // Secondary filter — see docs/inventory.md: computed (available < minimumStock)
      // can't be expressed as a DB-level predicate here, so this path
      // filters in application code after fetching the (already
      // company/warehouse/product-scoped) candidate set.
      const rows = await this.prisma.inventoryBalance.findMany({
        where,
        include,
      });
      const mapped = rows
        .map((r) => this.toStockRow(r))
        .filter((r) => r.belowMinimum);
      const total = mapped.length;
      const start = (query.page - 1) * query.pageSize;
      return {
        items: mapped.slice(start, start + query.pageSize),
        pagination: { page: query.page, pageSize: query.pageSize, total },
      };
    }

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryBalance.count({ where }),
      this.prisma.inventoryBalance.findMany({
        where,
        include,
        orderBy: [{ variant: { product: { name: 'asc' } } }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((r) => this.toStockRow(r)),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  private toStockRow(
    row: InventoryBalance & {
      warehouse: Warehouse;
      variant: ProductVariant & { product: Product };
    },
  ): StockRowDto {
    const available = row.onHand.sub(row.reserved);
    const minimumStock = row.variant.product.minimumStock;
    const belowMinimum = minimumStock !== null && available.lt(minimumStock);
    return {
      productId: row.variant.product.id,
      variantId: row.variant.id,
      productCode: row.variant.product.code,
      sku: row.variant.sku,
      productName: row.variant.product.name,
      variantName: row.variant.name,
      productStatus: row.variant.product.status,
      warehouse: {
        id: row.warehouse.id,
        code: row.warehouse.code,
        name: row.warehouse.name,
      },
      onHand: row.onHand.toString(),
      reserved: row.reserved.toString(),
      available: available.toString(),
      incoming: row.incoming.toString(),
      minimumStock: minimumStock?.toString() ?? null,
      belowMinimum,
    };
  }

  async getProductStock(
    companyId: string,
    productId: string,
  ): Promise<ProductStockResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
    });
    if (!product) throw new ProductVariantNotFoundException();

    const variants = await this.prisma.productVariant.findMany({
      where: { productId },
      include: {
        inventoryBalances: { include: { warehouse: true } },
      },
    });

    return {
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      variants: variants.map((v) => ({
        variantId: v.id,
        variantName: v.name,
        sku: v.sku,
        warehouses: v.inventoryBalances.map((b) => ({
          warehouseId: b.warehouse.id,
          warehouseCode: b.warehouse.code,
          warehouseName: b.warehouse.name,
          onHand: b.onHand.toString(),
          reserved: b.reserved.toString(),
          available: b.onHand.sub(b.reserved).toString(),
          incoming: b.incoming.toString(),
        })),
      })),
    };
  }

  async getVariantStock(
    companyId: string,
    variantId: string,
  ): Promise<VariantStockResponse> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, product: { companyId } },
      include: {
        product: true,
        inventoryBalances: { include: { warehouse: true } },
      },
    });
    if (!variant) throw new ProductVariantNotFoundException();

    return {
      variantId: variant.id,
      productId: variant.product.id,
      productCode: variant.product.code,
      productName: variant.product.name,
      variantName: variant.name,
      sku: variant.sku,
      warehouses: variant.inventoryBalances.map((b) => ({
        warehouseId: b.warehouse.id,
        warehouseCode: b.warehouse.code,
        warehouseName: b.warehouse.name,
        onHand: b.onHand.toString(),
        reserved: b.reserved.toString(),
        available: b.onHand.sub(b.reserved).toString(),
        incoming: b.incoming.toString(),
      })),
    };
  }

  /**
   * Inventory-aware operational lookup — a deliberately separate query
   * from ProductsService.lookup (see docs/inventory.md's Facturación
   * preparation section and CLAUDE.md: never couple ProductsService to
   * inventory internals). Same exact-then-fuzzy ranking as the plain
   * product lookup; adds `available` for a given warehouse when provided.
   */
  async lookup(
    companyId: string,
    query: InventoryLookupQuery,
  ): Promise<InventoryLookupResponse> {
    let variantIds: string[] = [];
    let rows: (ProductVariant & {
      product: Product;
      codes: { type: string; code: string; active: boolean }[];
    })[] = [];

    if (query.barcode) {
      const normalized = query.barcode.trim();
      const codeRow = await this.prisma.productCode.findFirst({
        where: {
          companyId,
          type: 'BARCODE',
          code: normalized,
          active: true,
          variant: { active: true, product: { companyId, status: 'ACTIVE' } },
        },
        include: { variant: { include: { product: true, codes: true } } },
      });
      rows = codeRow ? [codeRow.variant] : [];
    } else {
      const term = query.search?.trim();
      const baseWhere: Prisma.ProductVariantWhereInput = {
        active: true,
        product: { companyId, status: 'ACTIVE' },
      };
      if (!term) {
        rows = await this.prisma.productVariant.findMany({
          where: baseWhere,
          include: { product: true, codes: true },
          orderBy: { product: { name: 'asc' } },
          take: query.limit,
        });
      } else {
        const exactRows = await this.prisma.productVariant.findMany({
          where: {
            ...baseWhere,
            OR: [
              { sku: { equals: term, mode: 'insensitive' } },
              { product: { code: { equals: term, mode: 'insensitive' } } },
              {
                codes: { some: { type: 'BARCODE', active: true, code: term } },
              },
            ],
          },
          include: { product: true, codes: true },
          take: query.limit,
        });
        const exactIds = new Set(exactRows.map((v) => v.id));
        const remaining = query.limit - exactRows.length;
        const fuzzyRows =
          remaining > 0
            ? await this.prisma.productVariant.findMany({
                where: {
                  ...baseWhere,
                  id: { notIn: [...exactIds] },
                  OR: [
                    { name: { contains: term, mode: 'insensitive' } },
                    { sku: { contains: term, mode: 'insensitive' } },
                    {
                      product: {
                        name: { contains: term, mode: 'insensitive' },
                      },
                    },
                    {
                      product: {
                        code: { contains: term, mode: 'insensitive' },
                      },
                    },
                    {
                      codes: {
                        some: { code: { contains: term, mode: 'insensitive' } },
                      },
                    },
                  ],
                },
                include: { product: true, codes: true },
                take: remaining,
              })
            : [];
        rows = [...exactRows, ...fuzzyRows];
      }
    }

    variantIds = rows.map((v) => v.id);
    let availableByVariant = new Map<string, string>();
    if (query.warehouseId && variantIds.length > 0) {
      const balances = await this.prisma.inventoryBalance.findMany({
        where: {
          companyId,
          warehouseId: query.warehouseId,
          productVariantId: { in: variantIds },
        },
      });
      availableByVariant = new Map(
        balances.map((b) => [
          b.productVariantId,
          b.onHand.sub(b.reserved).toString(),
        ]),
      );
    }

    const items: InventoryLookupItem[] = rows.map((v) => ({
      productId: v.product.id,
      variantId: v.id,
      productCode: v.product.code,
      sku: v.sku,
      name: v.product.name,
      variantName: v.name,
      barcode:
        v.codes.find((c) => c.type === 'BARCODE' && c.active)?.code ?? null,
      productType: v.product.productType,
      active: v.active && v.product.status === 'ACTIVE',
      available: query.warehouseId
        ? (availableByVariant.get(v.id) ?? '0')
        : null,
    }));

    return { items };
  }

  async listMovements(
    companyId: string,
    query: MovementListQuery,
  ): Promise<MovementListResponse> {
    const where: Prisma.StockMovementWhereInput = {
      companyId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.variantId ? { productVariantId: query.variantId } : {}),
      ...(query.productId ? { variant: { productId: query.productId } } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.referenceType ? { referenceType: query.referenceType } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            occurredAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            variant: {
              OR: [
                { sku: { contains: query.search, mode: 'insensitive' } },
                {
                  product: {
                    code: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  product: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  codes: {
                    some: {
                      code: { contains: query.search, mode: 'insensitive' },
                    },
                  },
                },
              ],
            },
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: { warehouse: true, variant: { include: { product: true } } },
        orderBy: { occurredAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
    ]);

    const userIds = [
      ...new Set(
        rows.map((r) => r.createdBy).filter((id): id is string => !!id),
      ),
    ];
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({ where: { id: { in: userIds } } })
        : [];
    const nameById = new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );

    return {
      items: rows.map((r) =>
        toMovementDto(
          r,
          r.createdBy ? (nameById.get(r.createdBy) ?? null) : null,
        ),
      ),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getMovementById(
    companyId: string,
    id: string,
  ): Promise<StockMovementDto> {
    const movement = await this.prisma.stockMovement.findFirst({
      where: { id, companyId },
      include: { warehouse: true, variant: { include: { product: true } } },
    });
    if (!movement) throw new StockMovementNotFoundException();
    const name = movement.createdBy
      ? await this.prisma.user.findUnique({ where: { id: movement.createdBy } })
      : null;
    return toMovementDto(
      movement,
      name ? `${name.firstName} ${name.lastName}`.trim() : null,
    );
  }

  // ---------- Initial balance ----------

  async createInitialBalance(
    ctx: RequestContext,
    input: CreateInitialBalanceInput,
  ): Promise<InitialBalanceResponse> {
    const warehouse = await this.loadWarehouseContext(
      ctx.companyId,
      input.warehouseId,
    );

    const combined = this.combineQuantityLines(
      input.lines.map((l) => ({
        productVariantId: l.productVariantId,
        amount: l.quantity,
      })),
    );

    const variantContexts = new Map<string, VariantWithProduct>();
    for (const line of combined) {
      variantContexts.set(
        line.productVariantId,
        await this.loadVariantContext(ctx.companyId, line.productVariantId),
      );
    }

    for (const line of combined) {
      const variant = variantContexts.get(line.productVariantId)!;
      if (!variant.product.trackInventory)
        throw new ProductDoesNotTrackInventoryException();
      if (
        exceedsDecimalPrecision(
          line.amount,
          variant.product.baseUnit.decimalPlaces,
        )
      ) {
        throw new InvalidQuantityPrecisionException(
          variant.product.baseUnit.name,
          variant.product.baseUnit.decimalPlaces,
        );
      }
      const existingMovement = await this.prisma.stockMovement.findFirst({
        where: {
          companyId: ctx.companyId,
          warehouseId: warehouse.id,
          productVariantId: line.productVariantId,
        },
      });
      if (existingMovement)
        throw new InitialBalanceAlreadyEstablishedException();
    }

    const occurredAt = input.occurredAt ?? new Date();

    const movements = await this.prisma.$transaction(async (tx) => {
      const created: StockMovement[] = [];
      for (const line of combined) {
        const variant = variantContexts.get(line.productVariantId)!;
        const movement = await this.applyMovement(tx, ctx, {
          warehouse,
          variant,
          movementType: 'INITIAL_BALANCE',
          quantity: line.amount,
          reason: 'Saldo inicial',
          notes: input.notes,
          occurredAt,
        });
        created.push(movement);
      }
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'Warehouse',
          entityId: warehouse.id,
          metadata: {
            change: 'initial_balance_created',
            warehouseName: warehouse.name,
            lines: combined.map((l) => ({
              productName: variantContexts.get(l.productVariantId)!.product
                .name,
              variantName: variantContexts.get(l.productVariantId)!.name,
              quantity: l.amount,
            })),
          },
        },
        tx,
      );
      return created;
    });

    // Only reached once the transaction above has committed.
    for (const movement of movements) {
      this.realtimePublisher.stockChanged(
        ctx.companyId,
        movement.warehouseId,
        movement.productVariantId,
      );
    }

    return {
      movements: movements.map((m) =>
        toMovementDto(
          {
            ...m,
            warehouse,
            variant: variantContexts.get(m.productVariantId)!,
          },
          null,
        ),
      ),
    };
  }

  // ---------- Reservations (internal — no public API in this task, see docs/inventory.md) ----------

  async reserve(
    ctx: RequestContext,
    params: {
      warehouseId: string;
      productVariantId: string;
      quantity: string;
      sourceType: string;
      sourceId: string;
      expiresAt?: Date;
    },
  ): Promise<StockReservation> {
    const warehouse = await this.loadWarehouseContext(
      ctx.companyId,
      params.warehouseId,
    );
    const variant = await this.loadVariantContext(
      ctx.companyId,
      params.productVariantId,
    );
    if (!variant.product.trackInventory)
      throw new ProductDoesNotTrackInventoryException();
    if (
      exceedsDecimalPrecision(
        params.quantity,
        variant.product.baseUnit.decimalPlaces,
      )
    ) {
      throw new InvalidQuantityPrecisionException(
        variant.product.baseUnit.name,
        variant.product.baseUnit.decimalPlaces,
      );
    }
    if (Number(params.quantity) <= 0)
      throw new InsufficientAvailableStockException();

    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          warehouseId: warehouse.id,
          productVariantId: variant.id,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          quantity: params.quantity,
          expiresAt: params.expiresAt ?? null,
          createdBy: ctx.userId,
        },
      });

      const balance = await tx.inventoryBalance.upsert({
        where: {
          companyId_warehouseId_productVariantId: {
            companyId: ctx.companyId,
            warehouseId: warehouse.id,
            productVariantId: variant.id,
          },
        },
        create: {
          companyId: ctx.companyId,
          warehouseId: warehouse.id,
          productVariantId: variant.id,
          onHand: 0,
          reserved: params.quantity,
          incoming: 0,
        },
        update: { reserved: { increment: params.quantity } },
      });
      if (balance.onHand.sub(balance.reserved).lt(0)) {
        throw new InsufficientAvailableStockException();
      }
      return reservation;
    });
  }

  /** Releases up to `quantity` (default: everything still outstanding) back to AVAILABLE — see docs/inventory.md's reservation state machine. */
  async release(
    ctx: RequestContext,
    reservationId: string,
    quantity?: string,
  ): Promise<StockReservation> {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await this.findReservationScopedOrThrow(
        tx,
        ctx.companyId,
        reservationId,
      );
      const remaining = reservation.quantity.sub(reservation.consumedQuantity);
      const releaseAmount = quantity ? new Prisma.Decimal(quantity) : remaining;
      if (releaseAmount.lte(0) || releaseAmount.gt(remaining)) {
        throw new InsufficientAvailableStockException();
      }

      const newQuantity = reservation.quantity.sub(releaseAmount);
      const newRemaining = newQuantity.sub(reservation.consumedQuantity);
      const status = newRemaining.eq(0)
        ? reservation.consumedQuantity.gt(0)
          ? 'CONSUMED'
          : 'RELEASED'
        : reservation.status;

      const updated = await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { quantity: newQuantity, status },
      });

      await tx.inventoryBalance.update({
        where: {
          companyId_warehouseId_productVariantId: {
            companyId: ctx.companyId,
            warehouseId: reservation.warehouseId,
            productVariantId: reservation.productVariantId,
          },
        },
        data: { reserved: { decrement: releaseAmount } },
      });

      return updated;
    });
  }

  /**
   * Reduces the reservation's outstanding quantity without creating a
   * StockMovement — the caller (a future Delivery/Sales domain
   * operation) creates the matching physical exit in the SAME
   * transaction if one is needed. See docs/inventory.md, section 96 of
   * the task spec.
   */
  async consume(
    ctx: RequestContext,
    reservationId: string,
    quantity: string,
    tx?: Prisma.TransactionClient,
  ): Promise<StockReservation> {
    const run = async (client: Prisma.TransactionClient) => {
      const reservation = await this.findReservationScopedOrThrow(
        client,
        ctx.companyId,
        reservationId,
      );
      const remaining = reservation.quantity.sub(reservation.consumedQuantity);
      const consumeAmount = new Prisma.Decimal(quantity);
      if (consumeAmount.lte(0) || consumeAmount.gt(remaining)) {
        throw new InsufficientAvailableStockException();
      }

      const newQuantity = reservation.quantity.sub(consumeAmount);
      const newConsumed = reservation.consumedQuantity.add(consumeAmount);
      const status = newQuantity.eq(0) ? 'CONSUMED' : 'PARTIALLY_CONSUMED';

      const updated = await client.stockReservation.update({
        where: { id: reservation.id },
        data: { quantity: newQuantity, consumedQuantity: newConsumed, status },
      });

      await client.inventoryBalance.update({
        where: {
          companyId_warehouseId_productVariantId: {
            companyId: ctx.companyId,
            warehouseId: reservation.warehouseId,
            productVariantId: reservation.productVariantId,
          },
        },
        data: { reserved: { decrement: consumeAmount } },
      });

      return updated;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  private async findReservationScopedOrThrow(
    client: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<StockReservation> {
    const reservation = await client.stockReservation.findFirst({
      where: { id, companyId },
    });
    if (!reservation) throw new InsufficientAvailableStockException();
    return reservation;
  }

  // ---------- Rebuild (admin-safe recovery — see docs/inventory.md) ----------

  /**
   * Reconstructs InventoryBalance from StockMovement (onHand) and active
   * StockReservation rows (reserved) — never exposed to ordinary users,
   * see docs/inventory.md. Safe to run repeatedly; fully replaces
   * existing projection rows for the given scope.
   */
  async rebuildInventoryBalances(
    companyId?: string,
  ): Promise<{ warehouseVariantPairs: number }> {
    const movementGroups = await this.prisma.stockMovement.groupBy({
      by: ['companyId', 'warehouseId', 'productVariantId'],
      where: companyId ? { companyId } : undefined,
      _sum: { quantity: true },
    });
    const reservationGroups = await this.prisma.stockReservation.groupBy({
      by: ['companyId', 'warehouseId', 'productVariantId'],
      where: {
        ...(companyId ? { companyId } : {}),
        status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] },
      },
      _sum: { quantity: true },
    });

    const key = (
      companyId_: string,
      warehouseId: string,
      productVariantId: string,
    ) => `${companyId_}::${warehouseId}::${productVariantId}`;
    const reservedByKey = new Map(
      reservationGroups.map((g) => [
        key(g.companyId, g.warehouseId, g.productVariantId),
        g._sum.quantity ?? ZERO,
      ]),
    );

    let count = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const g of movementGroups) {
        const k = key(g.companyId, g.warehouseId, g.productVariantId);
        const onHand = g._sum.quantity ?? ZERO;
        const reserved = reservedByKey.get(k) ?? ZERO;
        reservedByKey.delete(k);
        await tx.inventoryBalance.upsert({
          where: {
            companyId_warehouseId_productVariantId: {
              companyId: g.companyId,
              warehouseId: g.warehouseId,
              productVariantId: g.productVariantId,
            },
          },
          create: {
            companyId: g.companyId,
            warehouseId: g.warehouseId,
            productVariantId: g.productVariantId,
            onHand,
            reserved,
            incoming: 0,
          },
          update: { onHand, reserved },
        });
        count += 1;
      }
      // Variants with active reservations but no movements yet (onHand=0).
      for (const [k, reserved] of reservedByKey) {
        const [companyId_, warehouseId, productVariantId] = k.split('::');
        await tx.inventoryBalance.upsert({
          where: {
            companyId_warehouseId_productVariantId: {
              companyId: companyId_,
              warehouseId,
              productVariantId,
            },
          },
          create: {
            companyId: companyId_,
            warehouseId,
            productVariantId,
            onHand: 0,
            reserved,
            incoming: 0,
          },
          update: { reserved },
        });
        count += 1;
      }
    });

    return { warehouseVariantPairs: count };
  }

  // ---------- Internal helpers ----------

  /**
   * The one place that writes a StockMovement and its InventoryBalance
   * side effect atomically — see class doc comment on concurrency.
   * `quantity` must already be signed, non-zero, and precision-checked
   * by the caller.
   */
  private async applyMovement(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    params: {
      warehouse: Warehouse;
      variant: VariantWithProduct;
      movementType: MovementType;
      quantity: string;
      unitCost?: string;
      currencyId?: string;
      referenceType?: string;
      referenceId?: string;
      reason?: string;
      notes?: string;
      occurredAt: Date;
    },
  ): Promise<StockMovement> {
    const movement = await tx.stockMovement.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        branchId: ctx.branchId ?? null,
        warehouseId: params.warehouse.id,
        productVariantId: params.variant.id,
        movementType: params.movementType,
        quantity: params.quantity,
        unitCost: params.unitCost ?? null,
        currencyId: params.currencyId ?? null,
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        reason: params.reason ?? null,
        notes: params.notes ?? null,
        occurredAt: params.occurredAt,
        createdBy: ctx.userId,
      },
    });

    const updatedBalance = await tx.inventoryBalance.upsert({
      where: {
        companyId_warehouseId_productVariantId: {
          companyId: ctx.companyId,
          warehouseId: params.warehouse.id,
          productVariantId: params.variant.id,
        },
      },
      create: {
        companyId: ctx.companyId,
        warehouseId: params.warehouse.id,
        productVariantId: params.variant.id,
        onHand: params.quantity,
        reserved: 0,
        incoming: 0,
      },
      update: { onHand: { increment: params.quantity } },
    });

    const effectiveAllowNegative =
      params.variant.product.allowNegativeStock &&
      params.warehouse.allowNegativeStock;
    if (!effectiveAllowNegative && updatedBalance.onHand.lt(0)) {
      throw new InsufficientStockException();
    }

    return movement;
  }

  private async loadWarehouseContext(
    companyId: string,
    warehouseId: string,
  ): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, companyId },
    });
    if (!warehouse) throw new WarehouseNotFoundException();
    return warehouse;
  }

  private async loadVariantContext(
    companyId: string,
    productVariantId: string,
  ): Promise<VariantWithProduct> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: productVariantId, product: { companyId } },
      include: VARIANT_WITH_PRODUCT_INCLUDE,
    });
    if (!variant) throw new ProductVariantNotFoundException();
    return variant;
  }

  /** Combines duplicate variant lines by summing their signed amounts — see docs/inventory.md's documented duplicate-line rule. */
  private combineQuantityLines(
    lines: { productVariantId: string; amount: string }[],
  ): { productVariantId: string; amount: string }[] {
    const totals = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const current = totals.get(line.productVariantId) ?? ZERO;
      totals.set(line.productVariantId, current.add(line.amount));
    }
    return [...totals.entries()].map(([productVariantId, amount]) => ({
      productVariantId,
      amount: amount.toString(),
    }));
  }

  /** Exposed for StockAdjustmentsService — see stock-adjustments.service.ts. */
  async applyAdjustmentLine(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    params: {
      warehouse: Warehouse;
      productVariantId: string;
      quantityDelta: string;
      reason?: string;
      referenceType: string;
      referenceId: string;
      occurredAt: Date;
    },
  ): Promise<StockMovement> {
    const variant = await this.loadVariantContext(
      ctx.companyId,
      params.productVariantId,
    );
    if (!variant.product.trackInventory)
      throw new ProductDoesNotTrackInventoryException();
    if (
      exceedsDecimalPrecision(
        params.quantityDelta,
        variant.product.baseUnit.decimalPlaces,
      )
    ) {
      throw new InvalidQuantityPrecisionException(
        variant.product.baseUnit.name,
        variant.product.baseUnit.decimalPlaces,
      );
    }
    const movementType: MovementType =
      Number(params.quantityDelta) > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
    return this.applyMovement(tx, ctx, {
      warehouse: params.warehouse,
      variant,
      movementType,
      quantity: params.quantityDelta,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      reason: params.reason,
      occurredAt: params.occurredAt,
    });
  }

  /**
   * Exposed for SalesService — see sales.service.ts and docs/sales.md.
   * Always an OUT movement (`movementType: 'SALE'`), unlike
   * applyAdjustmentLine's signed in/out — a sale line only ever removes
   * stock in this task (no returns yet). Returns null (no movement, no
   * balance change) for a line whose product doesn't track inventory —
   * e.g. a SERVICE line — per the sales spec's non-inventory-item rule.
   */
  async applySaleLine(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    params: {
      warehouse: Warehouse;
      productVariantId: string;
      quantity: string;
      referenceType: string;
      referenceId: string;
      occurredAt: Date;
    },
  ): Promise<StockMovement | null> {
    const variant = await this.loadVariantContext(
      ctx.companyId,
      params.productVariantId,
    );
    if (!variant.product.trackInventory) return null;
    if (
      exceedsDecimalPrecision(
        params.quantity,
        variant.product.baseUnit.decimalPlaces,
      )
    ) {
      throw new InvalidQuantityPrecisionException(
        variant.product.baseUnit.name,
        variant.product.baseUnit.decimalPlaces,
      );
    }
    const outboundQuantity = new Prisma.Decimal(params.quantity)
      .neg()
      .toString();
    return this.applyMovement(tx, ctx, {
      warehouse: params.warehouse,
      variant,
      movementType: 'SALE',
      quantity: outboundQuantity,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      occurredAt: params.occurredAt,
    });
  }

  /**
   * Exposed for PurchaseReceiptsService — see purchase-receipts.service.ts
   * and docs/purchases.md. Always an IN movement (`movementType:
   * 'PURCHASE'`), and — unlike applySaleLine's silent no-op for a
   * non-tracked product — throws `ProductDoesNotTrackInventoryException`
   * instead: there is no such thing as a physical goods receipt for a
   * SERVICE product, so a receipt line referencing one is a caller error,
   * not a legitimate no-op. Carries the line's cost/currency snapshot onto
   * the StockMovement itself (`unitCost`/`currencyId` — see
   * docs/inventory.md), unlike a sale movement, which is never priced.
   */
  async applyPurchaseReceiptLine(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    params: {
      warehouse: Warehouse;
      productVariantId: string;
      quantity: string;
      unitCost: string;
      currencyId: string;
      referenceType: string;
      referenceId: string;
      occurredAt: Date;
    },
  ): Promise<StockMovement> {
    const variant = await this.loadVariantContext(
      ctx.companyId,
      params.productVariantId,
    );
    if (!variant.product.trackInventory) {
      throw new ProductDoesNotTrackInventoryException();
    }
    if (
      exceedsDecimalPrecision(
        params.quantity,
        variant.product.baseUnit.decimalPlaces,
      )
    ) {
      throw new InvalidQuantityPrecisionException(
        variant.product.baseUnit.name,
        variant.product.baseUnit.decimalPlaces,
      );
    }
    return this.applyMovement(tx, ctx, {
      warehouse: params.warehouse,
      variant,
      movementType: 'PURCHASE',
      quantity: params.quantity,
      unitCost: params.unitCost,
      currencyId: params.currencyId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      occurredAt: params.occurredAt,
    });
  }

  /**
   * Reversal for cancelling a CONFIRMED receipt — see docs/purchases.md.
   * Creates a NEW compensating `PURCHASE_RETURN` movement (the negative of
   * the original quantity); the original `PURCHASE` movement is never
   * edited or deleted, matching the immutable-ledger rule already used for
   * every other confirmed movement. Reuses the receipt line's own cost/
   * currency snapshot so the ledger keeps a coherent cost trail. Subject to
   * the SAME negative-stock policy as every other movement (via
   * applyMovement) — if the received goods were already consumed downstream
   * and reversing would drive `onHand` negative, this throws
   * `InsufficientStockException` exactly like any other movement would,
   * rather than special-casing returns to bypass the check.
   */
  async reversePurchaseReceiptLine(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    params: {
      warehouse: Warehouse;
      productVariantId: string;
      quantity: string;
      unitCost: string;
      currencyId: string;
      referenceType: string;
      referenceId: string;
      occurredAt: Date;
    },
  ): Promise<StockMovement> {
    const variant = await this.loadVariantContext(
      ctx.companyId,
      params.productVariantId,
    );
    const reversedQuantity = new Prisma.Decimal(params.quantity)
      .neg()
      .toString();
    return this.applyMovement(tx, ctx, {
      warehouse: params.warehouse,
      variant,
      movementType: 'PURCHASE_RETURN',
      quantity: reversedQuantity,
      unitCost: params.unitCost,
      currencyId: params.currencyId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      occurredAt: params.occurredAt,
    });
  }

  /** Exposed for WarehousesService/StockAdjustmentsService company-scoped warehouse loading — avoids a second, slightly different query implementation elsewhere. */
  async loadWarehouse(
    companyId: string,
    warehouseId: string,
  ): Promise<Warehouse> {
    return this.loadWarehouseContext(companyId, warehouseId);
  }

  combineDeltaLines(
    lines: {
      productVariantId: string;
      quantityDelta: string;
      reason?: string;
    }[],
  ): {
    productVariantId: string;
    quantityDelta: string;
    reason?: string;
  }[] {
    const totals = new Map<
      string,
      { amount: Prisma.Decimal; reason?: string }
    >();
    for (const line of lines) {
      const current = totals.get(line.productVariantId);
      if (current) {
        current.amount = current.amount.add(line.quantityDelta);
      } else {
        totals.set(line.productVariantId, {
          amount: new Prisma.Decimal(line.quantityDelta),
          reason: line.reason,
        });
      }
    }
    return [...totals.entries()].map(([productVariantId, v]) => ({
      productVariantId,
      quantityDelta: v.amount.toString(),
      reason: v.reason,
    }));
  }
}
