# Task 014 — Demo Dashboard / UX Polish

Status: COMPLETED — implementation and verification complete
Depends on: 013
Agent: Claude
Base branch: main
Branch: agent/claude-demo-ux-polish
PR: (not yet opened — see final report for exact push/PR status)

## Objective

Replace Gestión's placeholder authenticated home page with a real
dashboard (a small set of genuinely useful at-a-glance numbers — not a
decorative widget wall), and pass over the demo-critical screens for UX
rough edges. Cosmetic/UX work only — no new backend capability beyond one
small, justified, read-only aggregate endpoint.

## Acceptance criteria (as actually implemented)

- New `GET /dashboard/summary` (`apps/api/src/dashboard/`) — see
  [docs/dashboard.md](../../docs/dashboard.md) for the full design
  rationale. `@CompanyScoped()` only (no blanket route permission,
  matching `CompanyContextController`'s pattern); `DashboardService`
  independently gates each of six fields by the caller's own effective
  permissions (`AuthorizationService.getUserPermissions`), returning
  `null` — never a fabricated zero — for anything the caller can't read.
  Every field with an existing owning service delegates to it
  (`SalesService.list`, `InventoryService.listStock({belowMinimum:
  true})` — reusing Inventory's existing `AVAILABLE < minimumStock` rule
  verbatim, no invented threshold); the one genuinely new query is a
  currency-grouped Prisma `groupBy` SUM for today's confirmed sales
  (grouped by currency so multi-currency days are never blended into one
  misleading total), converted via `Decimal.toString()` — never
  `Number()`/`parseFloat()`.
- New shared DTOs (`packages/shared/src/dashboard.ts`,
  `DashboardSummaryResponse` with every field independently nullable) and
  a new `useDashboardSummary()` hook
  (`packages/auth-client/src/dashboard-hooks.ts`), wired through
  `createAuthClient` and Gestión's `lib/auth-client.ts` exactly like every
  other domain client.
- 6 new e2e tests (`apps/api/test/dashboard.e2e-spec.ts`) covering empty
  company, permission-based field omission, correct aggregate semantics
  (confirmed-today count/total, open drafts, active counts, recent sales,
  cross-checked directly against `GET /inventory/stock?belowMinimum=true`
  for exact equality), and full company isolation (parallel Company
  A/B fixtures, neither leaks into the other).
- `apps/gestion/src/app/(app)/page.tsx` rewritten from the stale
  "Bienvenido / Todavía no hay módulos de negocio instalados" placeholder
  into a real dashboard: a compact summary grid (ventas confirmadas
  hoy + total operado, borradores abiertos, clientes activos, productos
  activos, stock a revisar — the last one only rendered when > 0, all
  wired to click through to the relevant list screen), a recent confirmed
  sales table reusing the same status/date/money conventions as
  `/ventas`, and a permission-gated quick-actions row (Nueva venta/Nuevo
  cliente/Nuevo producto/Ajustar stock/Listas de precios — each only
  shown if the screen exists and the caller can use it). Loading
  skeletons distinct from the empty state; a single retryable error box
  for the one aggregate request (no per-widget partial-failure machinery
  — deliberately not overengineered for a single-request page); copy
  restricted to "Ventas confirmadas hoy"/"Total operado"/"Ventas
  recientes", never implying fiscal revenue.
- Stale foundation-era copy fixed: `AppShell`'s doc comment ("structural
  shell for future modules... no business navigation exists yet") and
  `docs/product-ui-principles.md`'s Gestión section (same claim) and
  Facturación section ("non-functional 'Facturación / POS' mode
  placeholders" — both modes have been real and functional since Prompts
  #11/#12).
- One real cross-app UX inconsistency found and fixed during manual
  verification: `dateStyle: 'short'` (rendering as "16/8/26") was used in
  six places — Facturación's `recent-sales-list.tsx` and Gestión's audit
  log, stock movements, and customer/product/price-list history feeds —
  while every other date display in the app (sale detail, print receipt,
  the new dashboard) uses `dateStyle: 'medium'` ("16 ago 2026"). All six
  changed to `medium` for consistency.
- Manual end-to-end verification, all in-browser: Gestión dashboard
  (summary numbers, recent sales, quick actions) → Clientes → Productos →
  Stock → Listas de precios → Facturación (home showing real Ventas/POS
  actions and recent sales) → confirmed a normal sale (customer search →
  product search → confirm dialog → success screen) → back to Gestión,
  dashboard's "Ventas confirmadas hoy" and total incremented by exactly
  the new sale's amount and the sale appeared at the top of "Ventas
  recientes" → POS (customer F2 → product scan → F10 → cash payment with
  change calculated correctly → success screen → "Nueva venta" reset) →
  back to Gestión, both the dashboard and `/stock/movimientos` reflected
  the new confirmed count/total and the POS sale's stock decrement. No
  step was faked; every number shown was independently cross-checked
  against the previous screen's state.
- Full regression: `npm run lint` (0 errors, the same 2 pre-existing
  `window.location.href` warnings), `npm run typecheck` (clean across all
  6 workspaces), `npm test` (55/55), `npm run test:e2e` (194/194, up from
  188 — the 6 new dashboard tests), `npm run test:facturacion` (33/33),
  `npm run build` (API + Gestión + Facturación all build clean).
- No schema change, no new migration, no duplicated business rule — the
  one new endpoint is justified in detail in
  [docs/dashboard.md](../../docs/dashboard.md).

## Out of scope

New business modules; any dashboard metric without a legitimate existing
rule behind it (no invented low-stock threshold beyond the existing
`Product.minimumStock`); fake analytics (trend arrows, period-over-period
comparisons, sparklines); hardcoded demo values; a general reporting/BI
module (see `docs/implementation-status.md`'s "Reporting" section, still
NOT IMPLEMENTED); a full application-shell redesign (only the specific
stale copy and the home route changed); Facturación/POS architecture
changes (only a date-format consistency fix); Prompt #15 (demo data +
presentation flow) — not started.
