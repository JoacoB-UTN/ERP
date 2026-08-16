/**
 * Shown when a user reaches an /administracion route directly (typed URL,
 * bookmark) without the permission it requires — the nav already hides
 * the link, but hiding a link is not a security boundary (see CLAUDE.md).
 * The real enforcement is the 403 the API already returns; this is just
 * the corresponding frontend state instead of a broken/blank page.
 */
export function Unauthorized() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-lg font-medium">No tenés permiso para ver esta sección.</p>
    </div>
  );
}
