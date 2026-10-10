# Design references and REA

When the user asks for a design or feature similar to a supplied reference
("algo parecido a", "un diseño como", or an equivalent request), use this
workflow alongside [product UI principles](../product-ui-principles.md).

## Select the evidence

- Screenshot or image: inspect the visible hierarchy, spacing, typography,
  density and states. Do not infer hidden behavior from a static image.
- Website: inspect the supplied page with available browser tools. Use REA
  when page structure, scripts or observed runtime behavior are needed to
  explain the requested interaction.
- Packaged or installed application: use REA's reverse-engineer-anything
  skill for the supplied target when artifact or runtime evidence is needed.
- Available source repository: use normal source inspection. REA is useful
  only for questions that source inspection cannot establish.

Use the supplied reference and requested feature as the scope. If the
reference is missing, ask for its link, image or application name. Do not
substitute an unrelated example. Distinguish observed facts, inferred
behavior and implementation choices in the findings.

## Adapt and implement

1. Identify the useful interaction and the ERP screen it belongs to. Summarize
   the aspects to adapt and the relevant constraints before implementation.
2. Keep the ERP's visual identity and existing components. Follow the product
   principles on branding, screen arrangement, progressive disclosure and
   keyboard-first invoicing.
3. Implement in a dedicated branch. Reuse existing API/domain logic and
   preserve company scope, permissions, money handling and audit behavior.
4. Follow AGENTS.md and multi-agent ownership rules. Reference analysis does
   not authorize overlapping edits to sensitive shared modules.
5. Verify the implemented interaction, keyboard operation, relevant responsive
   layouts and loading/empty/error states. Compare the result with the stated
   adaptation goals and run checks appropriate to the change.

Use Matt Pocock's planning, implementation and review skills when useful for
these stages; REA supplies evidence about the reference, not ERP business rules.

## Local integration

REA is an optional developer tool, not an ERP runtime dependency. Codex on the
configured workstation uses rea-agents 6.3.0 through MCP and its matching
reverse-engineer-anything skill. Restart or reconnect Codex after registration
so the new tools become available in its session.

Follow the installed skill for target-specific requirements. Basic visual
inspection does not require a native disassembler. Missing native engines
only affect analysis that needs them. Do not run setup or diagnostics before
every investigation when tools are already connected.

Upstream: https://github.com/morluto/rea
