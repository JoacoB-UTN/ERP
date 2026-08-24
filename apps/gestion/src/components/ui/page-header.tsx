import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel = 'Volver',
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {backLabel}
          </Link>
        )}
        {eyebrow && (
          <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {eyebrow}
          </div>
        )}
        <h1 className="text-xl leading-7 font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Compact heading for list/index pages — the Gestión → Ventas pattern (see
 * docs/desktop-ui-direction.md): a small operational title, an optional
 * inline count, and the primary action, with no explanatory subtitle. Use
 * this instead of `PageHeader` for routine list screens (Clientes,
 * Productos, Stock, etc.); `PageHeader` remains for detail/create/edit
 * pages, which still benefit from a back link or genuinely useful context.
 */
export function ListHeader({
  title,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex items-baseline gap-2.5">
        <h1 className="text-lg leading-6 font-semibold tracking-tight">{title}</h1>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
