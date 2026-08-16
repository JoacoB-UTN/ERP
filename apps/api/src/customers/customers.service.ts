import { Injectable } from '@nestjs/common';
import {
  normalizeTaxId,
  formatCuit,
  type CreateCustomerInput,
  type UpdateCustomerInput,
  type CustomerAddressInput,
  type UpdateCustomerAddressInput,
  type CustomerContactInput,
  type UpdateCustomerContactInput,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerLookupQuery,
  type CustomerLookupResponse,
  type CustomerSummary,
  type CustomerDetail,
  type CustomerAddressDto,
  type CustomerContactDto,
  type CustomerCategoryDto,
  type AuditEntityHistoryResponse,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import {
  CustomerNotFoundException,
  CustomerCodeAlreadyExistsException,
  CustomerTaxIdAlreadyExistsException,
  CustomerCategoryNotFoundException,
  CustomerAddressNotFoundException,
  CustomerContactNotFoundException,
} from './customers.exceptions';
import type {
  Customer,
  CustomerAddress,
  CustomerContact,
  CustomerCategory,
  Prisma,
} from '../generated/prisma/client';

type CustomerWithRelations = Customer & {
  addresses: CustomerAddress[];
  contacts: CustomerContact[];
  categoryAssignments: { category: CustomerCategory }[];
};

type AuditableCustomerFields = Record<
  | 'legalName'
  | 'tradeName'
  | 'taxId'
  | 'taxCondition'
  | 'creditLimit'
  | 'discountPercentage'
  | 'email'
  | 'phone'
  | 'status',
  unknown
>;

function toAddressDto(a: CustomerAddress): CustomerAddressDto {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    street: a.street,
    number: a.number,
    floor: a.floor,
    unit: a.unit,
    city: a.city,
    province: a.province,
    postalCode: a.postalCode,
    countryCode: a.countryCode,
    additionalInfo: a.additionalInfo,
    isDefault: a.isDefault,
  };
}

function toContactDto(c: CustomerContact): CustomerContactDto {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    mobile: c.mobile,
    notes: c.notes,
    isPrimary: c.isPrimary,
  };
}

function toCategoryDto(c: CustomerCategory): CustomerCategoryDto {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    active: c.active,
  };
}

function toSummary(c: Customer): CustomerSummary {
  const taxIdFormatted =
    c.taxId && (c.documentType === 'CUIT' || c.documentType === 'CUIL')
      ? formatCuit(c.taxId)
      : c.taxId;
  return {
    id: c.id,
    code: c.code,
    customerType: c.customerType,
    legalName: c.legalName,
    tradeName: c.tradeName,
    displayName: c.tradeName || c.legalName,
    documentType: c.documentType,
    taxId: c.taxId,
    taxIdFormatted,
    taxCondition: c.taxCondition,
    email: c.email,
    phone: c.phone,
    status: c.status,
  };
}

function toDetail(c: CustomerWithRelations): CustomerDetail {
  return {
    ...toSummary(c),
    mobile: c.mobile,
    website: c.website,
    creditLimit: c.creditLimit?.toString() ?? null,
    discountPercentage: c.discountPercentage?.toString() ?? null,
    notes: c.notes,
    addresses: c.addresses.map(toAddressDto),
    contacts: c.contacts.map(toContactDto),
    categories: c.categoryAssignments.map((a) => toCategoryDto(a.category)),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Only the fields worth diffing in an UPDATE audit record — see docs/customers.md ("especially important fields"). */
function pickAuditFields(c: Customer): AuditableCustomerFields {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName,
    taxId: c.taxId,
    taxCondition: c.taxCondition,
    creditLimit: c.creditLimit?.toString() ?? null,
    discountPercentage: c.discountPercentage?.toString() ?? null,
    email: c.email,
    phone: c.phone,
    status: c.status,
  };
}

function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  for (const key of Object.keys(before) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

/**
 * Keeps only the LAST isDefault:true per address `type` in a batch (e.g. a
 * create payload with multiple addresses) — a plain array pass, not a DB
 * query, since these rows don't exist yet. Standalone add/update calls use
 * a transactional `updateMany` instead (see addAddress/updateAddress).
 */
function resolveBatchAddressDefaults(
  addresses: CustomerAddressInput[],
): CustomerAddressInput[] {
  const seenTypes = new Set<string>();
  const reversed = [...addresses].reverse().map((a) => {
    if (a.isDefault) {
      if (seenTypes.has(a.type)) return { ...a, isDefault: false };
      seenTypes.add(a.type);
    }
    return a;
  });
  return reversed.reverse();
}

const CUSTOMER_WITH_RELATIONS_INCLUDE = {
  addresses: true,
  contacts: true,
  categoryAssignments: { include: { category: true } },
} satisfies Prisma.CustomerInclude;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    companyId: string,
    query: CustomerListQuery,
  ): Promise<CustomerListResponse> {
    const where: Prisma.CustomerWhereInput = { companyId };
    if (query.status) where.status = query.status;
    if (query.customerType) where.customerType = query.customerType;
    if (query.taxCondition) where.taxCondition = query.taxCondition;
    if (query.categoryId)
      where.categoryAssignments = { some: { categoryId: query.categoryId } };
    if (query.province) {
      where.addresses = {
        some: { province: { equals: query.province, mode: 'insensitive' } },
      };
    }
    if (query.search) {
      const term = query.search.trim();
      const normalizedTax = normalizeTaxId(term);
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { legalName: { contains: term, mode: 'insensitive' } },
        { tradeName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        ...(normalizedTax ? [{ taxId: { contains: normalizedTax } }] : []),
      ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortDir },
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map(toSummary),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /** Lightweight, ACTIVE-only search for future fast operational lookup (Facturación) — see docs/customers.md. */
  async lookup(
    companyId: string,
    query: CustomerLookupQuery,
  ): Promise<CustomerLookupResponse> {
    const where: Prisma.CustomerWhereInput = { companyId, status: 'ACTIVE' };
    if (query.search) {
      const term = query.search.trim();
      const normalizedTax = normalizeTaxId(term);
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { legalName: { contains: term, mode: 'insensitive' } },
        { tradeName: { contains: term, mode: 'insensitive' } },
        ...(normalizedTax ? [{ taxId: { contains: normalizedTax } }] : []),
      ];
    }
    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: { legalName: 'asc' },
      take: query.limit,
    });
    return {
      items: rows.map((c) => ({
        id: c.id,
        code: c.code,
        displayName: c.tradeName || c.legalName,
        legalName: c.legalName,
        taxId: c.taxId,
        taxCondition: c.taxCondition,
        status: c.status,
      })),
    };
  }

  async getById(companyId: string, id: string): Promise<CustomerDetail> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      include: CUSTOMER_WITH_RELATIONS_INCLUDE,
    });
    if (!customer) throw new CustomerNotFoundException();
    return toDetail(customer);
  }

  async getHistory(
    ctx: RequestContext,
    customerId: string,
    pagination: { page: number; pageSize: number },
  ): Promise<AuditEntityHistoryResponse> {
    await this.findScopedOrThrow(ctx.companyId, customerId);
    return this.auditService.getEntityHistory(
      ctx.companyId,
      'Customer',
      customerId,
      pagination,
    );
  }

  async create(
    ctx: RequestContext,
    input: CreateCustomerInput,
  ): Promise<CustomerDetail> {
    const normalizedTaxId = input.taxId ? normalizeTaxId(input.taxId) : null;
    if (normalizedTaxId) {
      await this.assertTaxIdAvailable(
        this.prisma,
        ctx.companyId,
        normalizedTaxId,
      );
    }
    if (input.categoryIds.length > 0) {
      await this.assertCategoriesBelongToCompany(
        ctx.companyId,
        input.categoryIds,
      );
    }
    const manualCode = input.code?.trim();
    if (manualCode) {
      await this.assertCodeAvailable(this.prisma, ctx.companyId, manualCode);
    }
    const addresses = resolveBatchAddressDefaults(input.addresses);

    const created = await this.prisma.$transaction(async (tx) => {
      const code = manualCode || (await this.nextCode(tx, ctx.companyId));

      const customer = await tx.customer.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          code,
          customerType: input.customerType,
          legalName: input.legalName,
          tradeName: input.tradeName || null,
          documentType: input.documentType ?? null,
          taxId: normalizedTaxId,
          taxCondition: input.taxCondition ?? null,
          email: input.email || null,
          phone: input.phone || null,
          mobile: input.mobile || null,
          website: input.website || null,
          creditLimit: input.creditLimit,
          discountPercentage: input.discountPercentage,
          notes: input.notes || null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        },
      });

      if (addresses.length > 0) {
        await tx.customerAddress.createMany({
          data: addresses.map((a) => ({ ...a, customerId: customer.id })),
        });
      }
      if (input.contacts.length > 0) {
        await tx.customerContact.createMany({
          data: input.contacts.map((c) => ({ ...c, customerId: customer.id })),
        });
      }
      if (input.categoryIds.length > 0) {
        await tx.customerCategoryAssignment.createMany({
          data: input.categoryIds.map((categoryId) => ({
            customerId: customer.id,
            categoryId,
          })),
        });
      }

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'Customer',
          entityId: customer.id,
          after: {
            code: customer.code,
            legalName: customer.legalName,
            tradeName: customer.tradeName,
            documentType: customer.documentType,
            taxId: customer.taxId,
            taxCondition: customer.taxCondition,
            status: customer.status,
          },
        },
        tx,
      );

      return customer;
    });

    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerDetail> {
    const existing = await this.prisma.customer.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { categoryAssignments: true },
    });
    if (!existing) throw new CustomerNotFoundException();

    const normalizedTaxId =
      input.taxId === undefined
        ? undefined
        : input.taxId
          ? normalizeTaxId(input.taxId)
          : null;
    const effectiveTaxId =
      normalizedTaxId === undefined ? existing.taxId : normalizedTaxId;
    if (effectiveTaxId) {
      await this.assertTaxIdAvailable(
        this.prisma,
        ctx.companyId,
        effectiveTaxId,
        existing.id,
      );
    }
    if (input.categoryIds) {
      await this.assertCategoriesBelongToCompany(
        ctx.companyId,
        input.categoryIds,
      );
    }

    const beforeSnapshot = pickAuditFields(existing);

    const data: Prisma.CustomerUpdateInput = { updatedBy: ctx.userId };
    if (input.customerType !== undefined)
      data.customerType = input.customerType;
    if (input.legalName !== undefined) data.legalName = input.legalName;
    if (input.tradeName !== undefined) data.tradeName = input.tradeName || null;
    if (input.documentType !== undefined)
      data.documentType = input.documentType;
    if (normalizedTaxId !== undefined) data.taxId = normalizedTaxId;
    if (input.taxCondition !== undefined)
      data.taxCondition = input.taxCondition;
    if (input.email !== undefined) data.email = input.email || null;
    if (input.phone !== undefined) data.phone = input.phone || null;
    if (input.mobile !== undefined) data.mobile = input.mobile || null;
    if (input.website !== undefined) data.website = input.website || null;
    if (input.creditLimit !== undefined) data.creditLimit = input.creditLimit;
    if (input.discountPercentage !== undefined)
      data.discountPercentage = input.discountPercentage;
    if (input.notes !== undefined) data.notes = input.notes || null;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id: existing.id },
        data,
      });

      const afterSnapshot = pickAuditFields(updated);
      const diff = diffFields(beforeSnapshot, afterSnapshot);
      if (Object.keys(diff.before).length > 0) {
        await this.auditService.recordFromContext(
          ctx,
          {
            action: 'UPDATE',
            entityType: 'Customer',
            entityId: id,
            before: diff.before,
            after: diff.after,
          },
          tx,
        );
      }

      if (input.categoryIds) {
        const currentIds = new Set(
          existing.categoryAssignments.map((a) => a.categoryId),
        );
        const nextIds = input.categoryIds;
        const addedIds = nextIds.filter((cid) => !currentIds.has(cid));
        const removedIds = [...currentIds].filter(
          (cid) => !nextIds.includes(cid),
        );
        if (addedIds.length > 0 || removedIds.length > 0) {
          if (removedIds.length > 0) {
            await tx.customerCategoryAssignment.deleteMany({
              where: { customerId: id, categoryId: { in: removedIds } },
            });
          }
          if (addedIds.length > 0) {
            await tx.customerCategoryAssignment.createMany({
              data: addedIds.map((categoryId) => ({
                customerId: id,
                categoryId,
              })),
            });
          }
          const touched = await tx.customerCategory.findMany({
            where: { id: { in: [...addedIds, ...removedIds] } },
          });
          const nameOf = (cid: string) =>
            touched.find((c) => c.id === cid)?.name ?? cid;
          await this.auditService.recordFromContext(
            ctx,
            {
              action: 'UPDATE',
              entityType: 'Customer',
              entityId: id,
              metadata: {
                change: 'categories_changed',
                categoriesAdded: addedIds.map(nameOf),
                categoriesRemoved: removedIds.map(nameOf),
              },
            },
            tx,
          );
        }
      }
    });

    return this.getById(ctx.companyId, id);
  }

  async deactivate(ctx: RequestContext, id: string): Promise<CustomerDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'INACTIVE') {
      return this.getById(ctx.companyId, id);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: { status: 'INACTIVE', updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'Customer',
          entityId: id,
          before: { status: 'ACTIVE' },
          after: { status: 'INACTIVE' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  async reactivate(ctx: RequestContext, id: string): Promise<CustomerDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'ACTIVE') {
      return this.getById(ctx.companyId, id);
    }
    if (existing.taxId) {
      await this.assertTaxIdAvailable(
        this.prisma,
        ctx.companyId,
        existing.taxId,
        id,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: { status: 'ACTIVE', updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'ACTIVATE',
          entityType: 'Customer',
          entityId: id,
          before: { status: 'INACTIVE' },
          after: { status: 'ACTIVE' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  // ---------- Addresses ----------

  async addAddress(
    ctx: RequestContext,
    customerId: string,
    input: CustomerAddressInput,
  ): Promise<CustomerAddressDto> {
    await this.findScopedOrThrow(ctx.companyId, customerId);
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, type: input.type, isDefault: true },
          data: { isDefault: false },
        });
      }
      const address = await tx.customerAddress.create({
        data: { ...input, customerId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Customer',
          entityId: customerId,
          metadata: {
            change: 'address_added',
            addressId: address.id,
            type: address.type,
            city: address.city,
            street: address.street,
          },
        },
        tx,
      );
      return address;
    });
    return toAddressDto(created);
  }

  async updateAddress(
    ctx: RequestContext,
    customerId: string,
    addressId: string,
    input: UpdateCustomerAddressInput,
  ): Promise<CustomerAddressDto> {
    await this.findScopedOrThrow(ctx.companyId, customerId);
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) throw new CustomerAddressNotFoundException();

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextType = input.type ?? existing.type;
      if (input.isDefault) {
        await tx.customerAddress.updateMany({
          where: {
            customerId,
            type: nextType,
            isDefault: true,
            id: { not: addressId },
          },
          data: { isDefault: false },
        });
      }
      const address = await tx.customerAddress.update({
        where: { id: addressId },
        data: input,
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Customer',
          entityId: customerId,
          metadata: {
            change: 'address_updated',
            addressId,
            type: address.type,
            city: address.city,
          },
        },
        tx,
      );
      return address;
    });
    return toAddressDto(updated);
  }

  async removeAddress(
    ctx: RequestContext,
    customerId: string,
    addressId: string,
  ): Promise<void> {
    await this.findScopedOrThrow(ctx.companyId, customerId);
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) throw new CustomerAddressNotFoundException();

    await this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id: addressId } });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Customer',
          entityId: customerId,
          metadata: {
            change: 'address_removed',
            addressId,
            type: existing.type,
            city: existing.city,
          },
        },
        tx,
      );
    });
  }

  // ---------- Contacts ----------

  async addContact(
    ctx: RequestContext,
    customerId: string,
    input: CustomerContactInput,
  ): Promise<CustomerContactDto> {
    await this.findScopedOrThrow(ctx.companyId, customerId);
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.customerContact.updateMany({
          where: { customerId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const contact = await tx.customerContact.create({
        data: { ...input, email: input.email || null, customerId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Customer',
          entityId: customerId,
          metadata: {
            change: 'contact_added',
            contactId: contact.id,
            name: contact.name,
            role: contact.role,
          },
        },
        tx,
      );
      return contact;
    });
    return toContactDto(created);
  }

  async updateContact(
    ctx: RequestContext,
    customerId: string,
    contactId: string,
    input: UpdateCustomerContactInput,
  ): Promise<CustomerContactDto> {
    await this.findScopedOrThrow(ctx.companyId, customerId);
    const existing = await this.prisma.customerContact.findFirst({
      where: { id: contactId, customerId },
    });
    if (!existing) throw new CustomerContactNotFoundException();

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.customerContact.updateMany({
          where: { customerId, isPrimary: true, id: { not: contactId } },
          data: { isPrimary: false },
        });
      }
      const contact = await tx.customerContact.update({
        where: { id: contactId },
        data: {
          ...input,
          ...(input.email !== undefined ? { email: input.email || null } : {}),
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Customer',
          entityId: customerId,
          metadata: {
            change: 'contact_updated',
            contactId,
            name: contact.name,
          },
        },
        tx,
      );
      return contact;
    });
    return toContactDto(updated);
  }

  async removeContact(
    ctx: RequestContext,
    customerId: string,
    contactId: string,
  ): Promise<void> {
    await this.findScopedOrThrow(ctx.companyId, customerId);
    const existing = await this.prisma.customerContact.findFirst({
      where: { id: contactId, customerId },
    });
    if (!existing) throw new CustomerContactNotFoundException();

    await this.prisma.$transaction(async (tx) => {
      await tx.customerContact.delete({ where: { id: contactId } });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Customer',
          entityId: customerId,
          metadata: {
            change: 'contact_removed',
            contactId,
            name: existing.name,
          },
        },
        tx,
      );
    });
  }

  // ---------- Internal helpers ----------

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<Customer> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
    });
    if (!customer) throw new CustomerNotFoundException();
    return customer;
  }

  /** Only ACTIVE customers count as a conflict — see docs/customers.md. */
  private async assertTaxIdAvailable(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    normalizedTaxId: string,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await client.customer.findFirst({
      where: {
        companyId,
        taxId: normalizedTaxId,
        status: 'ACTIVE',
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (conflict) throw new CustomerTaxIdAlreadyExistsException();
  }

  private async assertCodeAvailable(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    code: string,
  ): Promise<void> {
    const conflict = await client.customer.findFirst({
      where: { companyId, code },
    });
    if (conflict) throw new CustomerCodeAlreadyExistsException();
  }

  private async assertCategoriesBelongToCompany(
    companyId: string,
    categoryIds: string[],
  ): Promise<void> {
    const unique = [...new Set(categoryIds)];
    const found = await this.prisma.customerCategory.findMany({
      where: { id: { in: unique }, companyId },
    });
    if (found.length !== unique.length)
      throw new CustomerCategoryNotFoundException();
  }

  /** Atomic per-company counter — see CustomerCodeSequence in schema.prisma. */
  private async nextCode(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const seq = await tx.customerCodeSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return String(seq.lastValue).padStart(6, '0');
  }
}
