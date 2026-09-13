import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
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
          <Icon
            className={cn('mb-1 size-5', kind === 'error' ? 'text-destructive' : 'text-muted-foreground')}
          />
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

/**
 * A list row whose whole surface opens the record, not just the name.
 *
 * The clickable area is a real `<a>` in the row's first cell, stretched over
 * the row by `RowLink`'s `::after`. That is why this is not an onClick on the
 * `<tr>`: the anchor keeps everything a link is supposed to do — Tab reaches
 * it, Enter follows it, middle-click and Ctrl+click open a tab, the status bar
 * shows the destination, and right-click offers "copy link address". A row
 * that only responds to a plain left click gives up all of that, and none of
 * it can be put back by hand without reimplementing the browser.
 *
 * `relative` is what confines the overlay to this row. Measured rather than
 * assumed, since positioned table rows have a shaky reputation: with a 400px
 * row and the anchor in a 120px first cell, hit-testing returns the anchor at
 * the left edge, the middle and 5px from the right edge.
 *
 * A row can hold at most ONE `RowLink`, and any other control in it needs
 * `RowControls` — the overlay sits above the cells and would otherwise swallow
 * the click.
 */
export function LinkedRow({ className, children, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'group/row relative border-t border-border transition-colors hover:bg-muted/30 has-[a:focus-visible]:bg-muted/30',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

/**
 * The row's single navigating link, drawn in place but clickable across the
 * whole row. Underlines on row hover, not just on its own text, so the row
 * reads as one target.
 */
export function RowLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        'font-medium underline-offset-4 outline-none after:absolute after:inset-0 after:content-[""] group-hover/row:underline',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Wrapper for anything else clickable in a `LinkedRow`. Raises it above the
 * row overlay so its own click wins instead of being swallowed by it.
 */
export function RowControls({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('relative z-10 flex items-center gap-1.5', className)}>{children}</div>;
}

/**
 * The select-this-row equivalent of `RowLink`, for lists where a row opens a
 * side panel instead of a route. Same stretched overlay, and still a real
 * button, so Tab and Enter work and screen readers get `aria-pressed`.
 */
export function RowButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'font-medium text-primary underline-offset-4 outline-none after:absolute after:inset-0 after:content-[""] group-hover/row:underline',
        className,
      )}
      {...props}
    />
  );
}
