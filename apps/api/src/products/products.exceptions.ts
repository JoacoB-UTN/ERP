import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Same "don't reveal existence outside the caller's scope" reasoning used
 * throughout the codebase (CustomerNotFoundException, RoleNotFoundException)
 * — identical response whether the id doesn't exist at all or belongs to a
 * different company. See CLAUDE.md.
 */
export class ProductNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Producto no encontrado.', code: 'PRODUCT_NOT_FOUND' });
  }
}

export class ProductCodeAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe un producto con ese código en esta empresa.',
      code: 'PRODUCT_CODE_ALREADY_EXISTS',
    });
  }
}

/** Only checked against other ACTIVE variants — see docs/products.md. */
export class ProductSkuAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe una variante activa con ese SKU en esta empresa.',
      code: 'PRODUCT_SKU_ALREADY_EXISTS',
    });
  }
}

/** Only checked against other ACTIVE barcodes — see docs/products.md. */
export class ProductBarcodeAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message:
        'Ya existe un producto activo con ese código de barras en esta empresa.',
      code: 'PRODUCT_BARCODE_ALREADY_EXISTS',
    });
  }
}

/** Used both for a direct category lookup and for validating a categoryId referenced from a product payload. */
export class ProductCategoryNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Categoría no encontrada para esta empresa.',
      code: 'PRODUCT_CATEGORY_NOT_FOUND',
    });
  }
}

export class ProductCategoryCycleException extends ConflictException {
  constructor() {
    super({
      message: 'Esa categoría no puede ser su propio ancestro.',
      code: 'PRODUCT_CATEGORY_CYCLE',
    });
  }
}

export class BrandNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Marca no encontrada para esta empresa.',
      code: 'BRAND_NOT_FOUND',
    });
  }
}

export class UnitNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Unidad de medida no encontrada para esta empresa.',
      code: 'UNIT_NOT_FOUND',
    });
  }
}

/**
 * Registered for forward compatibility but not thrown anywhere in this
 * task — no sales/POS operation exists yet to restrict against an
 * inactive product (same documented decision as CUSTOMER_INACTIVE in
 * docs/customers.md). See docs/products.md.
 */
export class ProductInactiveException extends ConflictException {
  constructor() {
    super({ message: 'El producto está inactivo.', code: 'PRODUCT_INACTIVE' });
  }
}

export class ProductVariantNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Variante no encontrada.',
      code: 'PRODUCT_VARIANT_NOT_FOUND',
    });
  }
}

export class ProductCodeNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Código no encontrado.', code: 'PRODUCT_CODE_NOT_FOUND' });
  }
}

export class ProductInvalidInventoryConfigException extends BadRequestException {
  constructor(message: string) {
    super({ message, code: 'PRODUCT_INVALID_INVENTORY_CONFIG' });
  }
}
