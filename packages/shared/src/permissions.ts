/**
 * Central, platform-defined permission catalog. This is the single source
 * of truth consumed by the dev seed (apps/api/prisma/seed.ts) to populate
 * the `permissions` table, and by the frontend to render grouped,
 * human-readable role editors — see docs/authorization.md.
 *
 * Codes follow "module.resource.action" (e.g. "administration.roles.read").
 * Kept deliberately small: only what the current stage needs, plus a
 * modest set of future codes for modules that don't exist yet (no business
 * functionality is implied by a permission code existing here).
 */
export interface PermissionDefinition {
  code: string;
  module: string;
  resource: string;
  action: string;
  /** Spanish, shown directly in the role editor UI — see CLAUDE.md (user-facing text is Spanish). */
  description: string;
}

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // ---- Application access ----
  {
    code: 'apps.gestion.access',
    module: 'apps',
    resource: 'gestion',
    action: 'access',
    description: 'Puede acceder a Gestión',
  },
  {
    code: 'apps.facturacion.access',
    module: 'apps',
    resource: 'facturacion',
    action: 'access',
    description: 'Puede acceder a Facturación',
  },
  {
    code: 'apps.facturacion.pos.access',
    module: 'apps',
    resource: 'pos',
    action: 'access',
    description: 'Puede acceder al modo POS de Facturación',
  },

  // ---- Administration (current stage) ----
  {
    code: 'administration.users.read',
    module: 'administration',
    resource: 'users',
    action: 'read',
    description: 'Ver usuarios',
  },
  {
    code: 'administration.users.create',
    module: 'administration',
    resource: 'users',
    action: 'create',
    description: 'Invitar/crear usuarios',
  },
  {
    code: 'administration.users.update',
    module: 'administration',
    resource: 'users',
    action: 'update',
    description: 'Modificar usuarios',
  },
  {
    code: 'administration.users.disable',
    module: 'administration',
    resource: 'users',
    action: 'disable',
    description: 'Deshabilitar usuarios',
  },
  {
    code: 'administration.roles.read',
    module: 'administration',
    resource: 'roles',
    action: 'read',
    description: 'Ver roles',
  },
  {
    code: 'administration.roles.create',
    module: 'administration',
    resource: 'roles',
    action: 'create',
    description: 'Crear roles',
  },
  {
    code: 'administration.roles.update',
    module: 'administration',
    resource: 'roles',
    action: 'update',
    description: 'Modificar roles',
  },
  {
    code: 'administration.roles.delete',
    module: 'administration',
    resource: 'roles',
    action: 'delete',
    description: 'Eliminar roles',
  },
  {
    code: 'administration.roles.assign',
    module: 'administration',
    resource: 'roles',
    action: 'assign',
    description: 'Asignar roles a usuarios',
  },
  {
    code: 'administration.company.read',
    module: 'administration',
    resource: 'company',
    action: 'read',
    description: 'Ver datos de la empresa',
  },
  {
    code: 'administration.branches.read',
    module: 'administration',
    resource: 'branches',
    action: 'read',
    description: 'Ver sucursales',
  },
  {
    code: 'administration.audit.read',
    module: 'administration',
    resource: 'audit',
    action: 'read',
    description: 'Ver el historial de auditoría',
  },
  {
    code: 'administration.audit.export',
    module: 'administration',
    resource: 'audit',
    action: 'export',
    description: 'Exportar el historial de auditoría',
  },

  // ---- Customers (master data — see docs/customers.md) ----
  {
    code: 'customers.read',
    module: 'customers',
    resource: 'customers',
    action: 'read',
    description: 'Ver clientes',
  },
  {
    code: 'customers.create',
    module: 'customers',
    resource: 'customers',
    action: 'create',
    description: 'Crear clientes',
  },
  {
    code: 'customers.update',
    module: 'customers',
    resource: 'customers',
    action: 'update',
    description: 'Modificar clientes',
  },
  {
    code: 'customers.deactivate',
    module: 'customers',
    resource: 'customers',
    action: 'deactivate',
    description: 'Desactivar/reactivar clientes',
  },

  // ---- Products (catalog master data — see docs/products.md) ----
  // Categories/brands/units management reuses these same three permissions
  // (no dedicated products.catalog.manage) — same anti-fragmentation
  // decision as customers.read/create/update covering CustomerCategory.
  {
    code: 'products.read',
    module: 'products',
    resource: 'products',
    action: 'read',
    description: 'Ver productos',
  },
  {
    code: 'products.create',
    module: 'products',
    resource: 'products',
    action: 'create',
    description: 'Crear productos',
  },
  {
    code: 'products.update',
    module: 'products',
    resource: 'products',
    action: 'update',
    description: 'Modificar productos',
  },
  {
    code: 'products.deactivate',
    module: 'products',
    resource: 'products',
    action: 'deactivate',
    description: 'Desactivar/reactivar productos',
  },

  // ---- Inventory (ledger-based — see docs/inventory.md) ----
  // Seeing stock (inventory.stock.read) is deliberately separate from
  // being able to change it (inventory.adjustments.create/confirm) — see
  // docs/inventory.md's "sensitive inventory permissions" note.
  {
    code: 'inventory.warehouses.read',
    module: 'inventory',
    resource: 'warehouses',
    action: 'read',
    description: 'Ver depósitos',
  },
  {
    code: 'inventory.warehouses.create',
    module: 'inventory',
    resource: 'warehouses',
    action: 'create',
    description: 'Crear depósitos',
  },
  {
    code: 'inventory.warehouses.update',
    module: 'inventory',
    resource: 'warehouses',
    action: 'update',
    description: 'Modificar depósitos',
  },
  {
    code: 'inventory.warehouses.deactivate',
    module: 'inventory',
    resource: 'warehouses',
    action: 'deactivate',
    description: 'Desactivar/reactivar depósitos',
  },
  {
    code: 'inventory.stock.read',
    module: 'inventory',
    resource: 'stock',
    action: 'read',
    description: 'Ver existencias',
  },
  {
    code: 'inventory.movements.read',
    module: 'inventory',
    resource: 'movements',
    action: 'read',
    description: 'Ver movimientos de stock',
  },
  {
    code: 'inventory.adjustments.read',
    module: 'inventory',
    resource: 'adjustments',
    action: 'read',
    description: 'Ver ajustes de stock',
  },
  {
    code: 'inventory.adjustments.create',
    module: 'inventory',
    resource: 'adjustments',
    action: 'create',
    description: 'Crear ajustes de stock',
  },
  {
    code: 'inventory.adjustments.confirm',
    module: 'inventory',
    resource: 'adjustments',
    action: 'confirm',
    description: 'Confirmar ajustes de stock',
  },
  {
    code: 'inventory.initial-balance.create',
    module: 'inventory',
    resource: 'initial-balance',
    action: 'create',
    description: 'Cargar saldos iniciales de stock',
  },

  // ---- Pricing (price lists — see docs/pricing.md) ----
  // pricing.prices.read is deliberately separate from pricing.prices.update
  // — seeing current prices is not the same capability as changing them,
  // same reasoning as inventory.stock.read vs inventory.adjustments.create.
  {
    code: 'pricing.lists.read',
    module: 'pricing',
    resource: 'lists',
    action: 'read',
    description: 'Ver listas de precios',
  },
  {
    code: 'pricing.lists.create',
    module: 'pricing',
    resource: 'lists',
    action: 'create',
    description: 'Crear listas de precios',
  },
  {
    code: 'pricing.lists.update',
    module: 'pricing',
    resource: 'lists',
    action: 'update',
    description: 'Modificar listas de precios',
  },
  {
    code: 'pricing.lists.deactivate',
    module: 'pricing',
    resource: 'lists',
    action: 'deactivate',
    description: 'Desactivar/reactivar listas de precios',
  },
  {
    code: 'pricing.prices.read',
    module: 'pricing',
    resource: 'prices',
    action: 'read',
    description: 'Ver precios',
  },
  {
    code: 'pricing.prices.update',
    module: 'pricing',
    resource: 'prices',
    action: 'update',
    description: 'Modificar precios',
  },
  {
    code: 'pricing.prices.bulk_update',
    module: 'pricing',
    resource: 'prices',
    action: 'bulk_update',
    description: 'Actualizar precios en forma masiva',
  },

  // ---- Future modules (codes registered now; no functionality yet) ----
  {
    code: 'inventory.transfers.create',
    module: 'inventory',
    resource: 'transfers',
    action: 'create',
    description: 'Crear transferencias entre sucursales',
  },

  {
    code: 'sales.orders.read',
    module: 'sales',
    resource: 'orders',
    action: 'read',
    description: 'Ver pedidos de venta',
  },
  {
    code: 'sales.orders.create',
    module: 'sales',
    resource: 'orders',
    action: 'create',
    description: 'Crear pedidos de venta',
  },
  {
    code: 'sales.orders.update',
    module: 'sales',
    resource: 'orders',
    action: 'update',
    description: 'Modificar pedidos de venta',
  },
  {
    code: 'sales.orders.cancel',
    module: 'sales',
    resource: 'orders',
    action: 'cancel',
    description: 'Anular pedidos de venta',
  },
  {
    code: 'sales.invoices.read',
    module: 'sales',
    resource: 'invoices',
    action: 'read',
    description: 'Ver facturas',
  },
  {
    code: 'sales.invoices.create',
    module: 'sales',
    resource: 'invoices',
    action: 'create',
    description: 'Emitir facturas',
  },
  {
    code: 'sales.invoices.cancel',
    module: 'sales',
    resource: 'invoices',
    action: 'cancel',
    description: 'Anular facturas',
  },
  {
    code: 'sales.prices.change',
    module: 'sales',
    resource: 'prices',
    action: 'change',
    description: 'Modificar precios de venta',
  },
  { code: 'sales.costs.read', module: 'sales', resource: 'costs', action: 'read', description: 'Ver costos' },

  {
    code: 'purchases.orders.read',
    module: 'purchases',
    resource: 'orders',
    action: 'read',
    description: 'Ver órdenes de compra',
  },
  {
    code: 'purchases.orders.create',
    module: 'purchases',
    resource: 'orders',
    action: 'create',
    description: 'Crear órdenes de compra',
  },
  {
    code: 'purchases.orders.approve',
    module: 'purchases',
    resource: 'orders',
    action: 'approve',
    description: 'Aprobar órdenes de compra',
  },

  {
    code: 'treasury.read',
    module: 'treasury',
    resource: 'treasury',
    action: 'read',
    description: 'Ver tesorería',
  },
  {
    code: 'treasury.receipts.create',
    module: 'treasury',
    resource: 'receipts',
    action: 'create',
    description: 'Registrar cobros',
  },
  {
    code: 'treasury.payments.create',
    module: 'treasury',
    resource: 'payments',
    action: 'create',
    description: 'Registrar pagos',
  },

  {
    code: 'accounting.read',
    module: 'accounting',
    resource: 'accounting',
    action: 'read',
    description: 'Ver contabilidad',
  },
  {
    code: 'accounting.entries.create',
    module: 'accounting',
    resource: 'entries',
    action: 'create',
    description: 'Crear asientos contables',
  },
  {
    code: 'accounting.entries.post',
    module: 'accounting',
    resource: 'entries',
    action: 'post',
    description: 'Contabilizar asientos',
  },

  {
    code: 'reports.read',
    module: 'reports',
    resource: 'reports',
    action: 'read',
    description: 'Ver reportes',
  },
  {
    code: 'configuration.manage',
    module: 'configuration',
    resource: 'configuration',
    action: 'manage',
    description: 'Administrar configuración de la empresa',
  },
];

export const PERMISSION_CODES = PERMISSION_CATALOG.map((p) => p.code);

/** Spanish grouping headers for the role editor — see docs/authorization.md. */
export const MODULE_LABELS: Record<string, string> = {
  apps: 'Aplicaciones',
  administration: 'Administración',
  customers: 'Clientes',
  products: 'Productos',
  inventory: 'Inventario',
  pricing: 'Precios',
  sales: 'Ventas',
  purchases: 'Compras',
  treasury: 'Tesorería',
  accounting: 'Contabilidad',
  reports: 'Reportes',
  configuration: 'Configuración',
};

export const RESOURCE_LABELS: Record<string, string> = {
  gestion: 'Gestión',
  facturacion: 'Facturación',
  pos: 'POS',
  users: 'Usuarios',
  roles: 'Roles',
  company: 'Empresa',
  branches: 'Sucursales',
  audit: 'Auditoría',
  customers: 'Clientes',
  products: 'Productos',
  warehouses: 'Depósitos',
  stock: 'Existencias',
  movements: 'Movimientos',
  adjustments: 'Ajustes',
  'initial-balance': 'Carga inicial',
  transfers: 'Transferencias',
  lists: 'Listas de precios',
  orders: 'Pedidos',
  invoices: 'Facturas',
  prices: 'Precios',
  costs: 'Costos',
  receipts: 'Cobros',
  payments: 'Pagos',
  entries: 'Asientos',
  treasury: 'Tesorería',
  accounting: 'Contabilidad',
  reports: 'Reportes',
  configuration: 'Configuración',
};

export const ACTION_LABELS: Record<string, string> = {
  read: 'Ver',
  create: 'Crear',
  update: 'Modificar',
  delete: 'Eliminar',
  disable: 'Deshabilitar',
  deactivate: 'Desactivar',
  assign: 'Asignar',
  access: 'Acceder',
  approve: 'Aprobar',
  cancel: 'Anular',
  change: 'Cambiar',
  post: 'Contabilizar',
  manage: 'Gestionar',
  export: 'Exportar',
  confirm: 'Confirmar',
  bulk_update: 'Actualización masiva',
};
