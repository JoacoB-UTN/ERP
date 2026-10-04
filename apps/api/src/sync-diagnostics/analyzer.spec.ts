import { analyzeCatalogs, renderMarkdown } from './analyzer';

const empty = (installationId = 'central') => ({
  version: 1,
  installationId,
  companyId: `company-${installationId}`,
  capturedAt: '2026-10-03T12:00:00Z',
  units: [] as { id: string; code: string }[],
  lines: [] as { id: string; name: string }[],
  categories: [] as { id: string; name: string; parentId: string | null }[],
  products: [] as {
    id: string;
    code: string;
    name: string;
    type: string;
    active: boolean;
    unitId: string;
    lineId: string | null;
    categoryId: string | null;
  }[],
  variants: [] as {
    id: string;
    productId: string;
    sku: string | null;
    active: boolean;
  }[],
  codes: [] as {
    id: string;
    variantId: string;
    type: string;
    code: string;
    active: boolean;
  }[],
});
const catalog = (side = 'central'): ReturnType<typeof empty> => ({
  ...empty(side),
  units: [{ id: 'u', code: 'UN' }],
  lines: [{ id: 'l', name: 'Oro' }],
  categories: [{ id: 'c', name: 'Hilos', parentId: null }],
  products: [
    {
      id: 'p',
      code: '00001',
      name: 'Hilo',
      type: 'PRODUCT',
      active: true,
      unitId: 'u',
      lineId: 'l',
      categoryId: 'c',
    },
  ],
  variants: [{ id: 'v', productId: 'p', sku: 'SKU', active: true }],
  codes: [
    { id: 'b', variantId: 'v', type: 'BARCODE', code: '00123', active: true },
  ],
});
const mapping = () => ({
  version: 1,
  central: { installationId: 'central', companyId: 'company-central' },
  local: { installationId: 'local', companyId: 'company-local' },
  entries: [
    { entity: 'unit', centralId: 'u', localId: 'u' },
    { entity: 'line', centralId: 'l', localId: 'l' },
    { entity: 'category', centralId: 'c', localId: 'c' },
    { entity: 'product', centralId: 'p', localId: 'p' },
    { entity: 'variant', centralId: 'v', localId: 'v' },
    { entity: 'code', centralId: 'b', localId: 'b' },
  ],
});

describe('offline catalog analyzer', () => {
  it('reports empty local adoption candidates without asserting import readiness', () => {
    const report = analyzeCatalogs(catalog(), empty('local'));
    expect(report.status).toBe('review-required');
    expect(report.summary['central.products']).toBe(1);
    expect(report.summary['local.products']).toBe(0);
    expect(report.findings.filter((f) => f.severity === 'review')).toHaveLength(
      6,
    );
  });
  it('does not turn matching names, IDs or codes into identity', () => {
    const report = analyzeCatalogs(catalog(), catalog('local'));
    expect(report.status).toBe('review-required');
    expect(report.findings.some((f) => f.severity === 'info')).toBe(false);
    expect(
      report.findings.some(
        (f) => f.entity === 'line' && f.reason.startsWith('Unmapped'),
      ),
    ).toBe(true);
  });
  it('accepts explicit consistent mappings including parent references', () => {
    const report = analyzeCatalogs(catalog(), catalog('local'), mapping());
    expect(report.status).toBe('clear');
    expect(report.summary.info).toBe(6);
  });
  it('never declares a child consistent with unmapped or differing dependencies', () => {
    const mappings = mapping();
    mappings.entries = mappings.entries.filter((m) => m.entity !== 'unit');
    const report = analyzeCatalogs(catalog(), catalog('local'), mappings);
    expect(report.status).toBe('review-required');
    expect(
      report.findings.some(
        (f) =>
          f.entity === 'product' &&
          f.field === 'unitId' &&
          f.severity === 'review',
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (f) =>
          ['product', 'variant', 'code'].includes(f.entity) &&
          f.severity === 'info',
      ),
    ).toBe(false);
  });
  it('conflicts on incompatible product types or mapped parent targets', () => {
    const local = catalog('local');
    local.products[0].type = 'SERVICE';
    expect(analyzeCatalogs(catalog(), local, mapping()).status).toBe(
      'conflicts',
    );
    local.products[0].type = 'PRODUCT';
    local.units.push({ id: 'u2', code: 'KG' });
    local.products[0].unitId = 'u2';
    expect(
      analyzeCatalogs(catalog(), local, mapping()).findings.some(
        (f) => f.field === 'unitId' && f.severity === 'conflict',
      ),
    ).toBe(true);
  });
  it('rejects missing references and category cycles without recursion', () => {
    const a = catalog();
    a.products[0].unitId = 'missing';
    expect(analyzeCatalogs(a, empty('local')).status).toBe('invalid-input');
    const b = catalog();
    b.categories = [
      { id: 'a', name: 'A', parentId: 'c' },
      { id: 'c', name: 'C', parentId: 'a' },
    ];
    expect(
      analyzeCatalogs(b, empty('local')).findings.some((f) =>
        f.reason.includes('cycle'),
      ),
    ).toBe(true);
  });
  it('bounds input and handles deep hierarchies iteratively', () => {
    const a = empty();
    a.categories = Array.from({ length: 5000 }, (_, i) => ({
      id: `c${i}`,
      name: 'Category',
      parentId: i ? `c${i - 1}` : null,
    }));
    expect(analyzeCatalogs(a, empty('local')).status).toBe('review-required');
    a.categories.push({ id: 'overflow', name: 'Too many', parentId: null });
    expect(analyzeCatalogs(a, empty('local')).status).toBe('invalid-input');
  });
  it('rejects duplicate IDs, unknown fields, forbidden business data and absent snapshots', () => {
    const a = catalog();
    a.units.push(a.units[0]);
    expect(analyzeCatalogs(a, empty('local')).status).toBe('invalid-input');
    for (const input of [
      undefined,
      null,
      { ...catalog(), stock: [] },
      { ...catalog(), products: [{ ...catalog().products[0], price: '1' }] },
    ])
      expect(analyzeCatalogs(input, empty('local')).status).toBe(
        'invalid-input',
      );
  });
  it('validates scope, types, existence and one-to-one mapping reuse', () => {
    const a = mapping();
    a.local.companyId = 'other';
    expect(analyzeCatalogs(catalog(), catalog('local'), a).status).toBe(
      'invalid-input',
    );
    const b = mapping();
    b.entries.push(b.entries[0]);
    expect(analyzeCatalogs(catalog(), catalog('local'), b).status).toBe(
      'conflicts',
    );
    const c = mapping();
    c.entries[0].localId = 'p';
    expect(analyzeCatalogs(catalog(), catalog('local'), c).status).toBe(
      'invalid-input',
    );
  });
  it('uses case-sensitive trimmed product/SKU/barcode keys and case-insensitive line names', () => {
    const a = catalog();
    a.lines.push({ id: 'l2', name: ' ORO ' });
    expect(analyzeCatalogs(a, empty('local')).status).toBe('conflicts');
    a.lines.pop();
    a.variants.push({ ...a.variants[0], id: 'v2', sku: 'sku' });
    expect(analyzeCatalogs(a, empty('local')).status).toBe('review-required');
    a.variants[1].sku = ' SKU ';
    expect(analyzeCatalogs(a, empty('local')).status).toBe('conflicts');
  });
  it('only active variants and active barcode rows participate in uniqueness, regardless of parent status', () => {
    const a = catalog();
    a.products[0].active = false;
    a.variants.push({ ...a.variants[0], id: 'v2' });
    expect(analyzeCatalogs(a, empty('local')).status).toBe('conflicts');
    a.variants[1].active = false;
    a.codes.push({ ...a.codes[0], id: 'b2', active: false });
    expect(analyzeCatalogs(a, empty('local')).status).toBe('review-required');
    a.codes[1].active = true;
    expect(analyzeCatalogs(a, empty('local')).status).toBe('conflicts');
    a.codes.forEach((c) => (c.type = 'SUPPLIER'));
    expect(analyzeCatalogs(a, empty('local')).status).toBe('review-required');
  });
  it('preserves barcode zeros and does not invent uniqueness across code types', () => {
    const a = catalog();
    a.codes.push({ ...a.codes[0], id: 'b2', code: '123' });
    expect(analyzeCatalogs(a, empty('local')).status).toBe('review-required');
  });
  it('does not infer names or coincident category IDs as parent mappings', () => {
    const maps = mapping();
    maps.entries = maps.entries.filter((m) => m.entity !== 'category');
    expect(
      analyzeCatalogs(catalog(), catalog('local'), maps).findings.some(
        (f) => f.field === 'categoryId' && f.reason.includes('no explicit'),
      ),
    ).toBe(true);
  });
  it('is stable when snapshot arrays and mappings are reordered, including conflicts', () => {
    const a = catalog();
    a.units.push({ id: 'u2', code: 'UN' });
    a.categories.push({ id: 'c2', name: 'Hilos', parentId: 'c' });
    const b = catalog('local');
    const maps = mapping();
    const before = analyzeCatalogs(a, b, maps);
    a.units.reverse();
    a.categories.reverse();
    maps.entries.reverse();
    expect(analyzeCatalogs(a, b, maps)).toEqual(before);
  });
  it('keeps contradictory mappings deterministic and rejects repeated origin scopes', () => {
    const maps = mapping();
    const local = catalog('local');
    local.units.push({ id: 'u2', code: 'KG' });
    maps.entries.push({ entity: 'unit', centralId: 'u', localId: 'u2' });
    const report = analyzeCatalogs(catalog(), local, maps);
    maps.entries.reverse();
    expect(analyzeCatalogs(catalog(), local, maps)).toEqual(report);
    expect(analyzeCatalogs(catalog(), catalog()).status).toBe('invalid-input');
    expect(
      analyzeCatalogs(catalog(), local).sources?.local.installationId,
    ).toBe('local');
  });
  it('blocks mapped descendants after outside-key collisions and reviews inactive reuse', () => {
    const local = catalog('local');
    local.products[0].code = 'other';
    local.products.push({ ...local.products[0], id: 'p2', code: '00001' });
    const report = analyzeCatalogs(catalog(), local, mapping());
    expect(report.status).toBe('conflicts');
    expect(
      report.findings.some(
        (f) =>
          ['product', 'variant', 'code'].includes(f.entity) &&
          f.severity === 'info',
      ),
    ).toBe(false);
    const retired = catalog('local');
    retired.variants.push({ ...retired.variants[0], id: 'v2', active: false });
    const historical = analyzeCatalogs(catalog(), retired, mapping());
    expect(historical.status).toBe('review-required');
    expect(
      historical.findings.some(
        (f) => ['variant', 'code'].includes(f.entity) && f.severity === 'info',
      ),
    ).toBe(false);
  });
  it('does not let duplicate category ID order alter invalid findings', () => {
    const a = catalog();
    a.categories.push({ id: 'c', name: 'Hilos', parentId: 'c' });
    const first = analyzeCatalogs(a, empty('local'));
    a.categories.reverse();
    expect(analyzeCatalogs(a, empty('local'))).toEqual(first);
  });
  it('escapes untrusted IDs in Markdown instead of emitting links, HTML or extra columns', () => {
    const a = empty();
    a.units.push({ id: '<img>![x](url)|`x`', code: 'UN' });
    const report = analyzeCatalogs(a, empty('local'));
    const markdown = renderMarkdown(report);
    expect(markdown).not.toContain('<img>');
    expect(markdown).not.toContain('![x](url)');
    expect(markdown).toContain('&#124;');
  });
});
