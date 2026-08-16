# Product & UI principles

This document is the reference for how the platform's frontend is split into
products, and what UX direction each product follows. Read this before
starting any frontend task — it exists so future work doesn't accidentally
merge the two products, duplicate business logic, or drift toward visually
copying a specific existing ERP.

## Two products, one backend

The platform ships **two separate user-facing applications** that share the
same API, auth system, database, domain logic, users/permissions, companies,
products, customers, and stock:

- **`apps/gestion`** — the ERP backoffice ("Gestión"). Administration:
  customers, suppliers, inventory, purchasing, sales, accounts
  receivable/payable, treasury, accounting, taxes, reports, admin, config,
  users/permissions.
- **`apps/facturacion`** — the fast operational sales app ("Facturación").
  Fast invoicing, credit/debit notes, customer/product/price/stock lookup,
  seller selection, payment methods, cash register operations, sales
  summary, electronic invoicing.

They are separate Next.js apps with separate shells because they optimize
for opposite things — an administrator configuring a chart of accounts and a
cashier ringing up a sale at a counter have nothing in common as UX problems,
even though they operate on the same underlying data.

**Never duplicate business logic between them.** Anything that isn't purely
presentational — validation rules, pricing/stock/tax calculations, session
handling, permission checks — lives in the API or in shared packages
(`packages/shared`, `packages/auth-client`) and is consumed by both apps.
Only UI composition, layout, and interaction patterns are allowed to differ.

## POS is a mode of Facturación, not a third app

The point-of-sale workflow is **not a separate backend or a separate
frontend application**. It's an operating mode within `apps/facturacion`,
sharing its auth, its API client, and its domain logic. Do not create a
`apps/pos` or a separate POS backend — POS-specific UI (larger touch
targets, a cart-first layout, hardware integrations) is additive UI on top
of Facturación's existing foundation.

## Functional inspiration, not visual cloning

Both products are functionally inspired by mature desktop ERPs (the kind of
workflows tools like Tango Gestión / Tango Facturador popularized: fast
keyboard-driven invoicing, a stable backoffice navigation model). This means
we can borrow **workflow shape** — e.g. the conceptual sale flow of
search/add product → review qty/price → confirm customer → select payment →
confirm — without borrowing anyone's visual identity.

Do not reproduce another product's branding, logos, color palette, tile
grid, menu layout, or exact screen arrangement. If a screen ends up looking
like a specific existing product, change it.

## Gestión: progressive disclosure, calm administration

Gestión should feel modern, calm, and predictable. It should make
administration clear, not overwhelming — ERP software is inherently
complex, but the UI does not need to expose that complexity all at once.

- Progressive disclosure over dense screens: show what's relevant to the
  current task, let the user drill in for more.
- Navigation organized by business area (sales, purchasing, accounting,
  etc.), not as a deeply nested tree unless a section genuinely needs it.
- Eventual shell shape: collapsible left sidebar + top app bar (global
  search, identity) + main workspace + contextual actions. This shell
  exists today only as a structural placeholder — no business navigation
  has been built yet.

## Facturación: speed and keyboard-first operation

Facturación should make selling fast. It prioritizes speed, keyboard
usability, and touch usability over feature density or visual richness.

- Minimize navigation, modals, and clicks between "start" and "sale
  confirmed."
- Every primary action should be reachable from the keyboard; keyboard
  shortcuts are first-class, not an afterthought bolted on later.
- Immediate feedback on every action — no ambiguous loading states during a
  sale.
- Search should work by barcode, SKU, or description without the user
  needing to know which one they're typing.
- POS (see above) should eventually let someone complete a sale with the
  minimum necessary interaction: product search → cart → customer → seller
  → totals → payment → confirm, no unnecessary intermediate screens.

Today, Facturación's shell is intentionally minimal: a single top bar (no
sidebar) with non-functional "Facturación / POS" mode placeholders. This is
deliberate — a sidebar-and-tree navigation model is the wrong shape for a
tool meant to be operated with a handful of keystrokes.

## Cross-cutting principles

- **Simplicity over completeness.** The system must not become complicated
  simply because ERP software is complex. Every screen should do the
  smallest useful thing well.
- **Consistency where it doesn't cost speed or clarity.** Shared design
  tokens, primitives (buttons, inputs, cards), API client, auth client, and
  validation schemas are reused across both apps. Full shared page layouts
  are not forced — Gestión and Facturación are allowed to diverge in shell
  and navigation because they solve different problems.
- **Accessibility is not optional.** Forms are keyboard-navigable, labeled,
  and give visible error feedback; interactive elements have accessible
  names.
- **No premature abstraction.** Don't build a large internal design system
  or a shared layout framework ahead of need. Extract shared UI only once a
  second real use case demonstrates it.

Preserve these principles in every future implementation: Gestión should
make administration clear, Facturación should make selling fast, and POS
should eventually make a sale possible with the minimum necessary
interaction.
