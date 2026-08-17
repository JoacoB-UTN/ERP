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
        <h1 className="text-2xl leading-8 font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
