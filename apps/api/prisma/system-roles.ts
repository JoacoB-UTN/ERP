import { PERMISSION_CATALOG } from '@erp/shared';

/**
 * Platform-defined system roles.
 *
 * Extracted from seed.ts so the two things that create companies can share one
 * definition: the demo seed (`seed.ts`) and real customer provisioning
 * (`provision.ts`, used by the ERP Server installer). Duplicating the list
 * would let a real installation drift from the demo one — the exact class of
 * bug nobody notices until a customer's Depósito role is missing a permission.
 */
export const ALL_PERMISSION_CODES = PERMISSION_CATALOG.map((p) => p.code);

export interface SystemRoleDefinition {
  name: string;
  description: string;
  permissionCodes: 'ALL' | string[];
}

/**
 * The 8 system roles created for every seeded company (see
 * docs/authorization.md and CLAUDE.md's RBAC rules). `permissionCodes:
 * 'ALL'` means "every code currently in the catalog" — ADMIN always gets
 * full access rather than a hardcoded `role === 'ADMIN'` check anywhere
 * in the authorization machinery itself.
 */
export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    name: 'Administrador',
    description: 'Acceso completo a la administración de la empresa.',
    permissionCodes: 'ALL',
  },
  {
    name: 'Gerente',
    description:
      'Visión amplia de la operación, sin administración de seguridad.',
    permissionCodes: [
      'apps.gestion.access',
      'apps.facturacion.access',
      'administration.company.read',
      'administration.branches.read',
      'customers.read',
      'customers.create',
      'customers.update',
      'customers.deactivate',
      'products.read',
      'products.create',
      'products.update',
      'products.deactivate',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'inventory.movements.read',
      'inventory.adjustments.read',
      'inventory.adjustments.create',
      'inventory.adjustments.confirm',
      'pricing.lists.read',
      'pricing.lists.create',
      'pricing.lists.update',
      'pricing.lists.deactivate',
      'pricing.prices.read',
      'pricing.prices.update',
      'pricing.prices.bulk_update',
      'sales.orders.read',
      'sales.invoices.read',
      'sales.documents.read',
      'sales.documents.create',
      'sales.documents.update',
      'sales.documents.confirm',
      'sales.documents.cancel',
      'purchases.suppliers.read',
      'purchases.orders.read',
      'purchases.goods-receipts.read',
      'treasury.read',
      'accounting.read',
      'reports.read',
      'system.backups.read',
    ],
  },
  {
    name: 'Ventas',
    description: 'Vende y factura en Facturación.',
    permissionCodes: [
      'apps.gestion.access',
      'apps.facturacion.access',
      'customers.read',
      'customers.create',
      'customers.update',
      'products.read',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'pricing.lists.read',
      'pricing.prices.read',
      'sales.orders.read',
      'sales.orders.create',
      'sales.orders.update',
      'sales.invoices.read',
      'sales.invoices.create',
      'sales.documents.read',
      'sales.documents.create',
      'sales.documents.update',
      'sales.documents.confirm',
    ],
  },
  {
    name: 'Depósito',
    description: 'Gestiona stock e inventario.',
    permissionCodes: [
      'apps.gestion.access',
      'products.read',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'inventory.movements.read',
      'inventory.adjustments.read',
      'inventory.adjustments.create',
      'inventory.transfers.create',
      'sales.documents.read',
    ],
  },
  {
    name: 'Compras',
    description: 'Gestiona proveedores, órdenes de compra y recepciones.',
    permissionCodes: [
      'apps.gestion.access',
      'products.read',
      'products.create',
      'products.update',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'pricing.lists.read',
      'pricing.prices.read',
      'purchases.suppliers.read',
      'purchases.suppliers.create',
      'purchases.suppliers.update',
      'purchases.suppliers.deactivate',
      'purchases.orders.read',
      'purchases.orders.create',
      'purchases.orders.update',
      'purchases.orders.approve',
      'purchases.orders.cancel',
      'purchases.goods-receipts.read',
      'purchases.goods-receipts.create',
      'purchases.goods-receipts.confirm',
      'purchases.goods-receipts.cancel',
    ],
  },
  {
    name: 'Tesorería',
    description: 'Gestiona cobros y pagos.',
    permissionCodes: [
      'apps.gestion.access',
      'apps.facturacion.access',
      'customers.read',
      'treasury.read',
      'treasury.receipts.create',
      'treasury.payments.create',
    ],
  },
  {
    name: 'Contabilidad',
    description: 'Gestiona asientos contables.',
    permissionCodes: [
      'apps.gestion.access',
      'customers.read',
      'products.read',
      'pricing.prices.read',
      'accounting.read',
      'accounting.entries.create',
      'accounting.entries.post',
      'reports.read',
    ],
  },
  {
    name: 'Solo lectura',
    description: 'Acceso de solo lectura a la operación.',
    permissionCodes: [
      'apps.gestion.access',
      'administration.company.read',
      'administration.branches.read',
      'customers.read',
      'products.read',
      'inventory.stock.read',
      'inventory.movements.read',
      'pricing.lists.read',
      'pricing.prices.read',
      'sales.orders.read',
      'sales.invoices.read',
      'sales.documents.read',
      'purchases.suppliers.read',
      'purchases.orders.read',
      'purchases.goods-receipts.read',
      'treasury.read',
      'accounting.read',
      'reports.read',
    ],
  },
];
