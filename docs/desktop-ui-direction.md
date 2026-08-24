# Desktop UI direction (target visual grammar)

**Status: APPROVED and propagated across Gestión's main operational
surfaces.** This document is the visual-direction companion to
[desktop-lan-architecture.md](desktop-lan-architecture.md). Prompt #17
prototyped this direction on Gestión's shell + `/ventas` only; Prompt #18
propagated it to Gestión's other primary routes (Inicio, Clientes,
Productos, Stock/Existencias, Movimientos, Ajustes, Depósitos, Listas de
precios, Usuarios, Roles, Auditoría) using `/ventas` as the visual source
of truth — see "Propagated standards" below for the exact rules that
came out of doing that, and implementation-status.md for what shipped.
Facturación/POS and Gestión's secondary detail/create/edit routes were
deliberately left outside this propagation pass — see that section for
why.

See also [product-ui-principles.md](product-ui-principles.md) (the
Gestión/Facturación product boundary this document must not violate —
this is a layout/density direction, not a new product split) and
`AGENTS.md` ("do not visually clone Tango or any existing ERP").

## Why current UI feels SaaS/AI-generated

Concrete findings from this repository's actual code, not a generic
list:

1. **Every page repeats the same title+subtitle template**, including
   dense operational screens. `PageHeader`
   (`apps/gestion/src/components/ui/page-header.tsx`) renders an `h1`
   at `text-2xl` followed by a muted descriptive paragraph, and it's
   used unconditionally — even `/ventas`, a list an operator opens
   dozens of times a day, carries "Ventas internas y su impacto
   operativo sobre precios y stock." above the toolbar
   (`apps/gestion/src/app/(app)/ventas/page.tsx`). That sentence is
   marketing/onboarding copy; a daily user does not need it explained
   to them on every visit.
2. **The home dashboard reads as a generic SaaS analytics template.**
   `apps/gestion/src/app/(app)/page.tsx`'s stat-card grid
   (`min-h-24`, large `text-2xl` numbers, muted captions) is the exact
   shape of a marketing dashboard mockup — four equal tiles in a
   bordered grid — regardless of whether the business actually
   benefits from that emphasis over, say, a denser operational summary.
3. **A repeated "icon-in-a-colored-square" decorative motif** shows up
   independently in at least four places: the Gestión sidebar wordmark
   (`Sidebar` in `sidebar.tsx`, a `size-7 rounded-md bg-primary` block
   around a `Building2` icon), the Facturación topbar wordmark
   (same shape, a `ReceiptText` icon), the dashboard's "Acciones
   rápidas" — actually fine, compact — and most notably Facturación's
   home page "Nueva operación" section
   (`apps/facturacion/src/app/(app)/page.tsx`), which wraps a `Plus`
   icon in a `size-9 rounded-md bg-accent` badge next to a heading and
   description. Four independent implementations of the same decorative
   pattern is a tell that it's being reached for by default, not because
   any one instance needs it.
4. **Facturación's home page is a marketing hero section, not a launch
   pad.** The "Nueva operación" block pairs an icon badge, a heading,
   a description sentence, and two large (`size: 'lg'`) call-to-action
   buttons — the shape of a SaaS product's empty-state/onboarding hero,
   not a counter tool whose entire job is getting an operator into a
   sale in the fewest possible clicks (which product-ui-principles.md
   already states is Facturación's whole purpose).
5. **Cards are the default container, not a deliberate choice.** Plain
   tables are wrapped in `rounded-md border border-border bg-card`
   regardless of whether there's any actual "grouped information" to
   set apart — the table *is* the page's content; wrapping it in a
   card adds a visual layer that communicates nothing. The same
   pattern repeats for the dashboard's quick-actions row and
   Facturación's hero section, both `border-y bg-card/60` bands, which
   is a card in function even where it isn't the literal `<Card>`
   component.
6. **Generous, uniform vertical rhythm everywhere.** Nearly every page
   composes with `gap-5`/`gap-6` between header, toolbar, and content
   — a spacing budget suited to a marketing dashboard with room to
   breathe, not to maximizing visible rows on a 1366×768 cashier
   screen (see "Viewports" in the final report).
7. **Uppercase, letter-spaced "eyebrow" labels** (`text-xs
   font-semibold tracking-[0.08em] uppercase`) — "OPERACIÓN DE VENTAS"
   on the Facturación home page, section group labels in the sidebar —
   are a SaaS marketing-site typographic habit, not something an
   operational tool needs to establish credibility on every screen.

None of this is a colors problem — the palette and typography are kept
as-is in this direction (see "Visual principles" below). The problem is
**structural**: too much explanatory prose, too much default
cardification, and too much vertical space spent on framing instead of
on the data itself.

## Target personality

**Modern desktop ERP — high information density, professional
operational software.** Not a marketing SaaS dashboard. Borrow the
strengths of mature desktop ERP software (dense toolbars, tables as the
primary work surface, compact aligned filters, predictable grids,
persistent operational context, keyboard-friendly actions) without
visually cloning any specific existing ERP's branding or layout
(`AGENTS.md`'s standing rule).

Gestión and Facturación stay two workspaces of one product family — see
"Gestión vs Facturación" below — not two unrelated visual systems.

## Page anatomy

```
┌───────────────────────────────────────────────────────────┐
│ Title bar   — compact, operational, no marketing subtitle  │
├───────────────────────────────────────────────────────────┤
│ Toolbar     — primary action(s), directly below the title  │
├───────────────────────────────────────────────────────────┤
│ Filters     — compact, inline, aligned, no separate card   │
├───────────────────────────────────────────────────────────┤
│                                                             │
│ Data grid   — the dominant visual element on the page      │
│                                                             │
├───────────────────────────────────────────────────────────┤
│ Status/footer — pagination, counts, compact                │
└───────────────────────────────────────────────────────────┘
```

- **Title**: smaller than today's `text-2xl` (target `text-lg`/`text-xl`
  territory), operational wording ("Ventas", not "Ventas — panel de
  operaciones comerciales"). A subtitle is only used when it conveys
  something the title genuinely can't — most list/operational screens
  don't need one at all.
- **Toolbar**: sits directly under the title, not separated by a full
  card boundary — primary action(s) top-right or immediately adjacent
  to the title.
- **Filters**: compact inputs, inline, aligned to a grid — not a
  bordered/backgrounded band pretending to be a card.
- **Table**: the primary content, not one visual element among several
  equally-weighted cards.
- **Status/footer**: pagination and counts, compact, no decorative
  weight.

## Cards

**Use a card only when it represents real grouped information that
benefits from being visually set apart from its neighbors** — e.g. a
summary panel next to a form, a small cluster of related fields, a
distinct sub-record (an address, a contact) inside a detail page. A
card is a statement that "this is a separable unit," not a default
layout primitive.

**Do not use a card:**
- To wrap a table that already fills the content area — the table's own
  borders and header row are enough structure.
- As a stand-in for a toolbar or filter bar — those are chrome, not
  content.
- As a hero/landing element on a page whose job is to get the user into
  a task, not to explain the task to them (see the Facturación home
  finding above).

## Tables

- **Density**: tighter row height than today's `px-4 py-2` default —
  target enough rows visible on a 1366×768 viewport to make a list
  screen feel like a real work surface, not a preview of one.
  Numeric columns right-aligned with `tabular-nums` (already correct
  in the current `/ventas` table — keep that).
- **Alignment**: predictable column grid, consistent across screens —
  identifiers/dates left, money right, status as a compact badge, not
  a wide pill.
- **Actions**: inline in the row (an icon button or a compact link),
  or a single row-level affordance — never a separate "Actions" card
  floating away from the row it acts on.
- **Status**: compact badges (`StatusBadge`, already the right shape)
  — keep, don't inflate.

## Forms

Compact, operational layout — labeled fields in a predictable grid,
grouped by what they mean to the business (not by database table
shape), no unnecessary card nesting around every field group. Save/
cancel actions anchored consistently (top-right or a sticky bottom bar
for long forms), matching what pricing's "N cambios sin guardar" bar
already does well — that pattern is worth reusing elsewhere, not
reinventing per screen.

## Dialogs

Use a dialog for a short, focused confirmation or a single-purpose
action that shouldn't navigate away from the current screen — sales'
existing confirm-sale dialog (Cliente/Total/one warning
sentence/Cancelar/Confirmar) is the right shape: minimal copy, no
decorative icon, no full-page takeover for something this small. Don't
use a dialog for anything that's actually a multi-step flow or a large
form — that belongs on its own route.

## Navigation

**Workspace vs module navigation are different levels.** Gestión and
Facturación are workspaces (see "Workspace switching concept" in the
final report); within Gestión, the sidebar's grouped sections (Operación,
Maestros, Inventario y precios, Administración) are module navigation.
Don't conflate the two — a workspace switch changes what kind of tool
you're using; a module navigation changes what part of the backoffice
you're looking at. Facturación intentionally has no module-level nested
navigation (product-ui-principles.md already states why: it's a single
fast workspace, not a backoffice with a tree).

## Status bar

A persistent, low-emphasis strip (bottom of the Gestión shell in this
prototype's concept) carrying company / branch / server connection /
user identity — see "Connection status concept" in the final report.
Compact, factual, never a second header competing for attention with
the real page content above it.

## Propagated standards (from Prompt #18)

Concrete, load-bearing numbers discovered/finalized while propagating
`/ventas`'s direction to the rest of Gestión — treat these as the actual
standard for any *new* Gestión list/index route, not just guidance:

- **List-page heading**: use `ListHeader`
  (`apps/gestion/src/components/ui/page-header.tsx`) — `text-lg`/`leading-6`
  title, an optional inline `meta` string (usually a row count, e.g. "19
  ventas"), primary action(s) on the right, **no description**. This is
  distinct from `PageHeader` (now `text-xl`, down from the original
  `text-2xl`), which remains for detail/create/edit routes that
  genuinely want a back link or real contextual copy — don't use
  `PageHeader` for a routine list screen, and don't invent a third
  heading pattern.
- **Subtitles are allowed only when they convey something the title
  can't** — a routine module name ("Clientes", "Productos",
  "Movimientos", "Usuarios") never needs one; a screen with a real
  domain caveat (why a number won't match, an irreversibility warning)
  still can, in the destination detail/confirmation UI, not on the list
  that leads to it.
- **Control height**: `--control-height` (2.25rem / 36px, already the
  app-wide `Input`/`Select`/`Button` default) is the baseline; toolbar
  filter controls specifically use `h-8` (32px, via `className="h-8 …
  py-1 text-sm"` on each `Input`/`Select`) to match `/ventas` exactly —
  both are within the approved 32–36px range, but pick one per context
  and stay consistent (toolbars: 32px; standalone form fields:
  default 36px).
- **Toolbar**: `Toolbar` (`apps/gestion/src/components/ui/toolbar.tsx`)
  is now a plain `flex flex-wrap items-center gap-2` row — no card band,
  no `bg-card`/`border-y`. A stacked `Label` above every filter field
  (the old Movimientos/Auditoría pattern) is replaced by either a bare
  `aria-label` (dropdowns, search boxes) or a small inline `text-xs
  text-muted-foreground` label immediately left of the field (date
  ranges: "Desde"/"Hasta") — never a label on its own row.
- **Table row density**: header cells `px-3 py-1.5`, data cells `px-3
  py-1`, `hover:bg-muted/30` on `<tr>`. The wrapping
  `overflow-x-auto rounded-md border border-border` container never
  carries `bg-card` — the border and header row are enough structure
  (see "Cards" above).
- **Page-level vertical rhythm**: the outer page container is
  `flex flex-col gap-2.5` (down from `gap-5`/`gap-6`) — heading,
  toolbar, table, and pagination sit close together as one working
  surface, not as separately-framed sections.
- **When cards are still allowed**: a genuinely separable block that
  isn't the page's main work surface — e.g. Usuarios' role-assignment
  side panel (`RoleAssignmentPanel`, a real "selected user's roles"
  sub-unit next to the main table) stayed a bordered `<aside>`, just
  with tighter padding (`p-3`, down from `p-4`). If in doubt, ask "is
  this the table/form the user came here for, or a secondary companion
  to it" — only the latter gets a card.
- **Sidebar section labels**: dropped the uppercase + `tracking-[0.08em]`
  treatment (a SaaS design-system tic) in favor of plain sentence case
  at `text-[0.6875rem] font-semibold text-muted-foreground/80` — still
  visually distinct from nav items, without reading as a marketing
  eyebrow label. Grouping itself (Operación/Maestros/Inventario y
  precios/Administración) is unchanged.
- **Dashboard (Inicio)**: the KPI stat-card grid became one compact,
  bordered inline strip (`flex flex-wrap items-center gap-x-5 … text-sm`,
  "value label" pairs like "2 ventas confirmadas hoy · ARS 28.900,00
  total operado · 1 borrador abierto …", each a link where the old card
  was) — same underlying `useDashboardSummary()` fields and null-checks,
  no calculation changed. "Acciones rápidas" dropped its
  `border-y bg-card/60` band and uppercase eyebrow label; it's now a
  bare `flex flex-wrap gap-2` row of outline buttons directly under the
  KPI strip. Ventas recientes' own heading shrank to match (`text-sm`,
  muted) since it's a secondary section on this page, not the page's own
  title.
- **Left deliberately untouched in this pass**: Facturación/POS (a
  different operational role — see "Gestión vs Facturación" below), and
  Gestión's secondary nested routes (customer/product detail pages,
  create/edit forms, categorías/marcas/unidades) beyond what they
  inherited automatically from `PageHeader`'s smaller title — propagating
  into those is future work, not assumed to be finished by this pass.

## Gestión vs Facturación

They remain related (same design tokens, same primitives, same
identity system) but keep different operational density, per
product-ui-principles.md's existing, unchanged boundary:

- **Gestión** — the denser workspace under this new direction: dense
  toolbars, tables as the primary surface, compact filters — but still
  progressive disclosure for genuinely complex configuration (a price
  list's Resumen/Precios/Historial tabs stay tabs, not one giant page).
- **Facturación** — stays the leaner, faster, keyboard-first workspace
  it already is. This direction's density push is a Gestión-primary
  concern; Facturación's shell only gains enough visual family
  resemblance (identity, connection status placement, workspace
  switcher) to read as "the same ERP," not Gestión's row density or
  toolbar complexity. Do not make Facturación as dense as Gestión for
  consistency's own sake — product-ui-principles.md's speed-first
  mandate for Facturación is unchanged by this document.
