import type { ReactNode } from 'react';
import { AlertCircle, Inbox, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function TableRowsSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return Array.from({ length: rows }).map((_, row) => (
    <tr key={row} aria-hidden="true">
      {Array.from({ length: columns }).map((__, column) => (
        <td key={column}>
          <div
            className={cn(
              'h-3.5 animate-pulse rounded bg-muted',
              column === 0 ? 'w-16' : column === 1 ? 'w-36' : 'w-24',
            )}
          />
        </td>
      ))}
    </tr>
  ));
}

export function TableMessage({
  columns,
  kind = 'empty',
  title,
  description,
  action,
}: {
  columns: number;
  kind?: 'empty' | 'filtered' | 'error';
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const Icon = kind === 'error' ? AlertCircle : kind === 'filtered' ? SearchX : Inbox;

  return (
    <tr>
      <td colSpan={columns} className="h-44 text-center">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-1.5 px-4">
          <Icon className={cn('mb-1 size-5', kind === 'error' ? 'text-destructive' : 'text-muted-foreground')} />
          <p className="font-medium text-foreground">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {action && <div className="mt-2">{action}</div>}
        </div>
      </td>
    </tr>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  itemLabel,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        Página {page} de {totalPages} · {total} {itemLabel}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Anterior
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
