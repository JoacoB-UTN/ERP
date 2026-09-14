/**
 * `placeholderData` for company-scoped queries — use this instead of
 * TanStack's `keepPreviousData`.
 *
 * Every company-scoped query in this package is keyed
 * `['company', companyId, ...]` (see CLAUDE.md), and `keepPreviousData`
 * keeps whatever the *previous* query resolved to while the next key
 * loads. That is what you want when only a filter or a page changed. It is
 * emphatically not what you want when the thing that changed is the
 * company: the user switches company and, for one render, the previous
 * company's customers, stock or account balances stay on screen as if they
 * belonged to the new one.
 *
 * AGENTS.md treats company isolation as the first thing to check in any
 * review. A frontend cache is not an authorization boundary — the API is —
 * but showing one company's rows under another company's name is a real
 * defect, and a user cannot tell a stale placeholder from live data.
 *
 * So: keep the previous data only when it came from a query for the SAME
 * company, and blank it otherwise. Paging and filtering keep their smooth
 * behaviour; switching company does not.
 */
export function keepPreviousCompanyData<TData>(
  companyId: string | null | undefined,
) {
  return (
    previousData: TData | undefined,
    // Structural rather than `Query`: TanStack types the argument with each
    // hook's own generics, so a bare `Query` fails to match the overload.
    // Only the key is needed here.
    previousQuery: { queryKey: readonly unknown[] } | undefined,
  ): TData | undefined => {
    if (previousData === undefined || !previousQuery) return undefined;

    const key = previousQuery.queryKey;
    // Defensive: a key that is not company-scoped cannot be proven to
    // belong to this company, so it is never reused.
    if (!Array.isArray(key) || key[0] !== 'company') return undefined;

    return key[1] === companyId ? previousData : undefined;
  };
}
