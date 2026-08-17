'use client';

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Progressive-disclosure section wrapper — a plain <details> so no extra
 * state is needed (same pattern as the audit detail page's "Detalle
 * técnico"). Shared by the customer and product create/edit forms — see
 * docs/product-ui-principles.md: the common fields must stay visible
 * without opening every advanced section.
 */
export function FormSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-md border border-border bg-card [&[open]>summary]:border-b [&[open]>summary]:border-border"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-4 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-ring">
        <div>
          <span className="text-sm font-semibold">{title}</span>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </details>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}
