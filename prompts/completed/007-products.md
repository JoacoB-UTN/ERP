# 007 — Products

Status: DONE

## Implemented scope

`apps/api/src/products`. Product/ProductVariant/ProductCode/
ProductCategory/Brand/UnitOfMeasure catalog, "default variant" pattern
for simple products, SKU/barcode uniqueness, search/lookup ranking.
Gestión: `/productos` list/create/detail/edit + categorías/marcas/
unidades.

## Relevant docs

[docs/products.md](../../docs/products.md)

## Verification

`apps/api/test/products.e2e-spec.ts`,
`apps/api/src/products/product-validation.spec.ts`.
