import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (v) =>
      v.trim() === v &&
      ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
  );
const label = (max: number) => z.string().trim().min(1).max(max);
const entitySchema = z.enum([
  'unit',
  'line',
  'category',
  'product',
  'variant',
  'code',
]);
type Entity = z.infer<typeof entitySchema>;
const rows = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(5000);
const snapshotSchema = z
  .object({
    version: z.literal(1),
    installationId: identifier,
    companyId: identifier,
    capturedAt: z.string().datetime({ offset: true }),
    units: rows(z.object({ id: identifier, code: label(30) }).strict()),
    lines: rows(z.object({ id: identifier, name: label(150) }).strict()),
    categories: rows(
      z
        .object({
          id: identifier,
          name: label(150),
          parentId: identifier.nullable(),
        })
        .strict(),
    ),
    products: rows(
      z
        .object({
          id: identifier,
          code: label(30),
          name: label(200),
          type: z.enum(['PRODUCT', 'SERVICE', 'KIT', 'MANUFACTURED']),
          active: z.boolean(),
          unitId: identifier,
          lineId: identifier.nullable(),
          categoryId: identifier.nullable(),
        })
        .strict(),
    ),
    variants: rows(
      z
        .object({
          id: identifier,
          productId: identifier,
          sku: z.string().trim().max(60).nullable(),
          active: z.boolean(),
        })
        .strict(),
    ),
    codes: rows(
      z
        .object({
          id: identifier,
          variantId: identifier,
          type: z.enum([
            'BARCODE',
            'SUPPLIER',
            'INTERNAL',
            'MARKETPLACE',
            'OTHER',
          ]),
          code: label(100),
          active: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
const scopeSchema = z
  .object({ installationId: identifier, companyId: identifier })
  .strict();
const mappingsSchema = z
  .object({
    version: z.literal(1),
    central: scopeSchema,
    local: scopeSchema,
    entries: rows(
      z
        .object({
          entity: entitySchema,
          centralId: identifier,
          localId: identifier,
        })
        .strict(),
    ),
  })
  .strict();
type Snapshot = z.infer<typeof snapshotSchema>;
type Row = { id: string; [field: string]: string | boolean | null };
export interface Finding {
  severity: 'invalid' | 'conflict' | 'review' | 'info';
  entity: string;
  centralId?: string;
  localId?: string;
  field?: string;
  reason: string;
  action: string;
}
export interface DiagnosticReport {
  version: 1;
  status: 'invalid-input' | 'conflicts' | 'review-required' | 'clear';
  summary: Record<string, number>;
  findings: Finding[];
  sources?: Record<
    'central' | 'local',
    { installationId: string; companyId: string; capturedAt: string }
  >;
}
const collections = {
  unit: 'units',
  line: 'lines',
  category: 'categories',
  product: 'products',
  variant: 'variants',
  code: 'codes',
} as const;
const entities = Object.keys(collections) as Entity[];
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const key = (entity: Entity, id: string) => JSON.stringify([entity, id]);
const dependencies: Partial<Record<Entity, [string, Entity][]>> = {
  category: [['parentId', 'category']],
  product: [
    ['unitId', 'unit'],
    ['lineId', 'line'],
    ['categoryId', 'category'],
  ],
  variant: [['productId', 'product']],
  code: [['variantId', 'variant']],
};

/** Pure diagnostic over explicitly scoped snapshots; never authorizes adoption. */
export function analyzeCatalogs(
  central: unknown,
  local: unknown,
  mappings?: unknown,
): DiagnosticReport {
  const findings: Finding[] = [];
  const summary: Record<string, number> = {};
  const metadata: Pick<DiagnosticReport, 'sources'> = {};
  const add = (finding: Finding) => {
    findings.push(finding);
  };
  const finish = (): DiagnosticReport => {
    findings.sort((a, b) =>
      cmp(
        JSON.stringify([
          a.severity,
          a.entity,
          a.centralId ?? '',
          a.localId ?? '',
          a.field ?? '',
          a.reason,
          a.action,
        ]),
        JSON.stringify([
          b.severity,
          b.entity,
          b.centralId ?? '',
          b.localId ?? '',
          b.field ?? '',
          b.reason,
          b.action,
        ]),
      ),
    );
    for (const severity of ['invalid', 'conflict', 'review', 'info'])
      summary[severity] = findings.filter(
        (f) => f.severity === severity,
      ).length;
    return {
      version: 1,
      status: summary.invalid
        ? 'invalid-input'
        : summary.conflict
          ? 'conflicts'
          : summary.review
            ? 'review-required'
            : 'clear',
      summary,
      findings,
      ...metadata,
    };
  };
  const c = snapshotSchema.safeParse(central);
  const l = snapshotSchema.safeParse(local);
  const m = mappingsSchema.safeParse(mappings);
  for (const [side, success] of [
    ['central', c.success],
    ['local', l.success],
    ['mappings', mappings === undefined || m.success],
  ] as const) {
    if (!success) {
      // Do not echo unknown field names or raw input values in reports.
      add({
        severity: 'invalid',
        entity: side,
        reason: 'Invalid snapshot or mapping schema.',
        action:
          'Use the documented strict version 1 format; remove unsupported fields.',
      });
    }
  }
  if (!c.success || !l.success || (mappings !== undefined && !m.success))
    return finish();
  const snapshots = { central: c.data, local: l.data };
  const source = (snapshot: Snapshot) => ({
    installationId: snapshot.installationId,
    companyId: snapshot.companyId,
    capturedAt: snapshot.capturedAt,
  });
  metadata.sources = { central: source(c.data), local: source(l.data) };
  if (c.data.installationId === l.data.installationId) {
    add({
      severity: 'invalid',
      entity: 'snapshot',
      reason: 'Central and local must identify distinct installations.',
      action: 'Provide separately identified installation snapshots.',
    });
    return finish();
  }
  const indexes = {
    central: new Map<string, Row>(),
    local: new Map<string, Row>(),
  };
  for (const side of ['central', 'local'] as const) {
    const snapshot = snapshots[side];
    const index = indexes[side];
    let duplicateIds = false;
    for (const entity of entities) {
      const records: Row[] = snapshot[collections[entity]];
      summary[`${side}.${collections[entity]}`] = records.length;
      for (const row of records) {
        const id = { [side === 'central' ? 'centralId' : 'localId']: row.id };
        if (index.has(key(entity, row.id))) {
          duplicateIds = true;
          add({
            severity: 'invalid',
            entity,
            ...id,
            field: 'id',
            reason: 'Duplicate entity ID within snapshot.',
            action: 'Correct the snapshot at its origin.',
          });
        }
        index.set(key(entity, row.id), row);
      }
    }
    if (duplicateIds) continue;
    for (const entity of entities)
      for (const row of snapshot[collections[entity]] as Row[]) {
        for (const [field, target] of dependencies[entity] ?? []) {
          const ref = row[field];
          if (typeof ref === 'string' && !index.has(key(target, ref)))
            add({
              severity: 'invalid',
              entity,
              [side === 'central' ? 'centralId' : 'localId']: row.id,
              field,
              reason: 'Referenced record is missing from this snapshot.',
              action: 'Include the complete catalog reference graph.',
            });
        }
      }
    // Iterative traversal avoids stack overflow for deep valid trees and cycles.
    const done = new Set<string>();
    const categories = new Map(snapshot.categories.map((row) => [row.id, row]));
    for (const start of [...categories.keys()].sort(cmp)) {
      const path = new Set<string>();
      let current: string | null = start;
      while (
        current !== null &&
        categories.has(current) &&
        !done.has(current)
      ) {
        if (path.has(current)) {
          add({
            severity: 'invalid',
            entity: 'category',
            [side === 'central' ? 'centralId' : 'localId']: [...path].sort(
              cmp,
            )[0],
            field: 'parentId',
            reason: 'Category parent cycle.',
            action: 'Repair the hierarchy before comparison.',
          });
          break;
        }
        path.add(current);
        current = categories.get(current)!.parentId;
      }
      for (const id of path) done.add(id);
    }
    checkUnique(snapshot, (entity, field, ids) => {
      for (const id of ids)
        add({
          severity: 'conflict',
          entity,
          [side === 'central' ? 'centralId' : 'localId']: id,
          field,
          reason: 'Catalog uniqueness rule is violated within this snapshot.',
          action:
            'Review duplicate keys at the origin; do not merge or renumber automatically.',
        });
    });
  }
  if (findings.some((f) => f.severity === 'invalid')) return finish();
  if (
    mappings !== undefined &&
    m.success &&
    (['central', 'local'] as const).some(
      (side) =>
        m.data[side].installationId !== snapshots[side].installationId ||
        m.data[side].companyId !== snapshots[side].companyId,
    )
  ) {
    add({
      severity: 'invalid',
      entity: 'mappings',
      reason: 'Mapping installation/company scope does not match snapshots.',
      action: 'Supply mappings bound to these exact two origins.',
    });
    return finish();
  }
  const entries = m.success
    ? [...m.data.entries].sort((a, b) =>
        cmp(
          JSON.stringify([a.entity, a.centralId, a.localId]),
          JSON.stringify([b.entity, b.centralId, b.localId]),
        ),
      )
    : [];
  const forward = new Map<string, (typeof entries)[number]>();
  const reverse = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    const ck = key(entry.entity, entry.centralId),
      lk = key(entry.entity, entry.localId);
    if (forward.has(ck) || reverse.has(lk))
      add({
        severity: 'conflict',
        ...entry,
        reason: 'Duplicate or contradictory mapping reuses an entity.',
        action: 'Keep one explicit one-to-one correspondence per entity.',
      });
    if (!indexes.central.has(ck) || !indexes.local.has(lk))
      add({
        severity: 'invalid',
        ...entry,
        reason: 'Mapping references an absent entity or wrong entity type.',
        action: 'Correct the mapping against these snapshots.',
      });
    forward.set(ck, entry);
    reverse.set(lk, entry);
  }
  if (
    findings.some(
      (f) =>
        f.severity === 'invalid' ||
        (f.entity !== 'central' &&
          f.reason.startsWith('Duplicate or contradictory')),
    )
  )
    return finish();
  const blocked = new Set<string>();
  const conflictingCentral = new Set(
    findings
      .filter((f) => f.severity === 'conflict' && f.centralId)
      .map((f) => key(f.entity as Entity, f.centralId!)),
  );
  const conflictingLocal = new Set(
    findings
      .filter((f) => f.severity === 'conflict' && f.localId)
      .map((f) => key(f.entity as Entity, f.localId!)),
  );
  const dependents = new Map<string, string[]>();
  for (const entry of entries) {
    const ck = key(entry.entity, entry.centralId);
    const a = indexes.central.get(ck)!;
    const b = indexes.local.get(key(entry.entity, entry.localId))!;
    const issue = (
      field: string,
      reason: string,
      severity: 'review' | 'conflict' = 'conflict',
    ) => {
      blocked.add(ck);
      add({
        severity,
        ...entry,
        field,
        reason,
        action: 'Review this correspondence and its dependencies manually.',
      });
    };
    if (
      conflictingCentral.has(ck) ||
      conflictingLocal.has(key(entry.entity, b.id))
    )
      blocked.add(ck);
    for (const field of Object.keys(a).filter(
      (field) =>
        field !== 'id' &&
        !(dependencies[entry.entity] ?? []).some(([ref]) => field === ref),
    )) {
      const normalize = (value: Row[string]) =>
        entry.entity === 'line' && field === 'name' && typeof value === 'string'
          ? value.toLowerCase()
          : value;
      if (normalize(a[field]) !== normalize(b[field]))
        issue(
          field,
          'Mapped records have different catalog values.',
          field === 'type' ? 'conflict' : 'review',
        );
    }
    for (const [field, target] of dependencies[entry.entity] ?? []) {
      const ar = a[field],
        br = b[field];
      if (ar === null && br === null) continue;
      if (typeof ar !== 'string' || typeof br !== 'string') {
        issue(field, 'Mapped reference presence differs.');
        continue;
      }
      const parentKey = key(target, ar);
      const parent = forward.get(parentKey);
      if (!parent) {
        issue(field, 'Reference has no explicit correspondence.', 'review');
        continue;
      }
      if (parent.localId !== br) {
        issue(field, 'Mapped reference points to a different local parent.');
        continue;
      }
      const children = dependents.get(parentKey) ?? [];
      children.push(ck);
      dependents.set(parentKey, children);
    }
  }
  for (const entity of entities) {
    for (const side of ['central', 'local'] as const)
      for (const row of snapshots[side][collections[entity]] as Row[]) {
        if (!(side === 'central' ? forward : reverse).has(key(entity, row.id)))
          add({
            severity: 'review',
            entity,
            [side === 'central' ? 'centralId' : 'localId']: row.id,
            reason: `Unmapped ${side} record; identity is unresolved.`,
            action:
              'Decide whether to adopt or explicitly map it, including its references; never infer identity from IDs or names.',
          });
      }
    const field =
      entity === 'product' || entity === 'unit'
        ? 'code'
        : entity === 'variant'
          ? 'sku'
          : entity === 'code'
            ? 'code'
            : null;
    if (!field) continue;
    const groups = new Map<string, Row[]>();
    const eligible = (row: Row) => entity !== 'code' || row.type === 'BARCODE';
    for (const row of snapshots.local[collections[entity]] as Row[])
      if (eligible(row) && row[field]) {
        const value = String(row[field]);
        const group = groups.get(value) ?? [];
        group.push(row);
        groups.set(value, group);
      }
    for (const row of snapshots.central[collections[entity]] as Row[])
      if (eligible(row) && row[field]) {
        const matches = groups.get(String(row[field])) ?? [];
        if (!matches.length) continue;
        const mapped = forward.get(key(entity, row.id));
        const unresolved = matches.filter(
          (match) => match.id !== mapped?.localId,
        );
        if (unresolved.length) {
          const collision =
            Boolean(mapped) &&
            (entity === 'product' ||
              entity === 'unit' ||
              (row.active === true &&
                unresolved.some((match) => match.active === true)));
          if (mapped) blocked.add(key(entity, row.id));
          add({
            severity: collision ? 'conflict' : 'review',
            entity,
            centralId: row.id,
            ...(unresolved.length === 1 ? { localId: unresolved[0].id } : {}),
            field,
            reason: mapped
              ? 'A catalog key also matches outside its explicit correspondence.'
              : 'Equal catalog key is only a candidate; it does not establish shared identity.',
            action:
              'Review explicit correspondence and active/inactive history before any adoption.',
          });
        }
      }
  }
  const queue = [...blocked];
  for (let i = 0; i < queue.length; i++)
    for (const child of dependents.get(queue[i]) ?? [])
      if (!blocked.has(child)) {
        blocked.add(child);
        queue.push(child);
        add({
          severity: 'review',
          ...forward.get(child)!,
          reason:
            'A mapped dependency has unresolved differences or conflicts.',
          action:
            'Resolve parent/reference findings before accepting this correspondence.',
        });
      }
  for (const entry of entries)
    if (!blocked.has(key(entry.entity, entry.centralId)))
      add({
        severity: 'info',
        ...entry,
        reason: 'Explicit correspondence is consistent within supplied fields.',
        action:
          'Human review remains required; this is not permission to import or synchronize.',
      });
  return finish();
}

function checkUnique(
  snapshot: Snapshot,
  report: (entity: Entity, field: string, ids: string[]) => void,
): void {
  const checks: [
    Entity,
    string,
    Row[],
    (row: Row) => boolean,
    (value: string) => string,
  ][] = [
    ['product', 'code', snapshot.products, () => true, (v) => v],
    ['unit', 'code', snapshot.units, () => true, (v) => v],
    ['line', 'name', snapshot.lines, () => true, (v) => v.toLowerCase()],
    ['variant', 'sku', snapshot.variants, (r) => r.active === true, (v) => v],
    [
      'code',
      'code',
      snapshot.codes,
      (r) => r.active === true && r.type === 'BARCODE',
      (v) => v,
    ],
  ];
  for (const [entity, field, records, eligible, normalize] of checks) {
    const groups = new Map<string, string[]>();
    for (const row of records)
      if (eligible(row) && row[field]) {
        const value = normalize(String(row[field]));
        const group = groups.get(value) ?? [];
        group.push(row.id);
        groups.set(value, group);
      }
    for (const ids of groups.values())
      if (ids.length > 1) report(entity, field, ids);
  }
}

export function renderMarkdown(report: DiagnosticReport): string {
  const escape = (value: string) =>
    value
      .replace(
        /[&<>]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!,
      )
      .replace(/\|/g, '&#124;')
      .split('')
      .map((c) =>
        c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
          ? ' '
          : '\\`*_[]'.includes(c)
            ? `\\${c}`
            : c,
      )
      .join('');
  return [
    '# Catalog adoption diagnostic',
    '',
    `Status: **${report.status}**`,
    '',
    'Read-only comparison. No result authorizes import or synchronization.',
    '',
    ...(report.sources
      ? (['central', 'local'] as const).map(
          (side) =>
            `- ${side}: ${escape(report.sources![side].installationId)} / ${escape(report.sources![side].companyId)}; captured ${escape(report.sources![side].capturedAt)}`,
        )
      : []),
    '',
    ...Object.keys(report.summary)
      .sort(cmp)
      .map((key) => `- ${escape(key)}: ${report.summary[key]}`),
    '',
    '| Severity | Entity | Central ID | Local ID | Field | Reason | Action |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.findings.map(
      (f) =>
        `| ${[f.severity, f.entity, f.centralId ?? '', f.localId ?? '', f.field ?? '', f.reason, f.action].map(escape).join(' | ')} |`,
    ),
    '',
  ].join('\n');
}
