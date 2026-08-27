import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateTaxIdForDocumentType } from '@erp/shared';

/**
 * Guards against a future edit reintroducing an invalid CUIT/CUIL literal
 * into the demo seed (see docs/purchases.md and the Prompt #21 review that
 * caught `30713344223`/`30714455009`/`30715566003` failing the project's
 * own mod-11 checksum). Deliberately parses `seed.ts`'s SOURCE TEXT rather
 * than importing/running it — seed.ts has real side effects (Prisma
 * connection, `main()` runs unconditionally at module load) and this test
 * only needs to check the literal `documentType`/`taxId` pairs passed to
 * `upsertSupplier`, never a live database.
 */
describe('seed.ts demo supplier tax ids', () => {
  const seedSource = readFileSync(
    join(__dirname, '../../prisma/seed.ts'),
    'utf8',
  );

  function extractUpsertSupplierBlocks(source: string): string[] {
    const blocks: string[] = [];
    const marker = 'await upsertSupplier({';
    let searchFrom = 0;
    for (;;) {
      const start = source.indexOf(marker, searchFrom);
      if (start === -1) break;
      const end = source.indexOf('});', start);
      if (end === -1) break;
      blocks.push(source.slice(start, end));
      searchFrom = end + 1;
    }
    return blocks;
  }

  const blocks = extractUpsertSupplierBlocks(seedSource);

  it('finds at least the 5 demo suppliers seeded by seedDemoSuppliers', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5);
  });

  it.each(
    blocks.map((block) => {
      const codeMatch = /code:\s*'([^']*)'/.exec(block);
      const documentTypeMatch = /documentType:\s*'([^']*)'/.exec(block);
      const taxIdMatch = /taxId:\s*'([^']*)'/.exec(block);
      return {
        code: codeMatch?.[1] ?? '(unknown)',
        documentType: documentTypeMatch?.[1] ?? null,
        taxId: taxIdMatch?.[1] ?? null,
      };
    }),
  )(
    'supplier $code has a taxId valid for its documentType ($documentType)',
    ({ code, documentType, taxId }) => {
      if (!taxId) return; // no taxId seeded for this supplier — nothing to validate
      const result = validateTaxIdForDocumentType(documentType, taxId);
      expect({ code, taxId, result }).toEqual({
        code,
        taxId,
        result: { valid: true },
      });
    },
  );
});
