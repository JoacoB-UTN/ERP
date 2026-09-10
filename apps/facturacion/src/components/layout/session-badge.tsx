import { cn } from '@/lib/utils';

/** Connection state shown as a dot on the avatar. */
export type ServerStatus = 'checking' | 'connected' | 'degraded' | 'disconnected';

const STATUS_DOT: Record<ServerStatus, string> = {
  // Neutral on purpose — 'checking' is a normal transient startup state, never
  // rendered as if something were already wrong.
  checking: 'bg-muted-foreground/40',
  connected: 'bg-success',
  degraded: 'bg-warning',
  disconnected: 'bg-destructive',
};

export const STATUS_LABEL: Record<ServerStatus, string> = {
  checking: 'Comprobando servidor…',
  connected: 'Servidor conectado',
  degraded: 'Servidor degradado',
  disconnected: 'Servidor sin conexión',
};

/**
 * Who is signed in and where: avatar, name, active company.
 *
 * Modelled on Untitled UI's `AvatarLabelGroup` (avatar + title + subtitle at
 * the same optical weight), rebuilt on this project's own primitives rather
 * than installed — pulling in their component would add React Aria and a second
 * design system next to the one every other screen already uses.
 *
 * The subtitle is the active COMPANY, not the email. On a multi-company
 * install, "which company am I operating on" changes what every screen shows
 * and is the thing a user can get wrong; their own email is not in doubt by the
 * time they are looking at this.
 *
 * Initials rather than a photo because `User` has no avatar field; there is no
 * image to show and inventing a placeholder face would be worse than the
 * initials the source component falls back to anyway.
 */
export function SessionBadge({
  firstName,
  lastName,
  subtitle,
  serverStatus,
  compact = false,
  className,
}: {
  firstName: string;
  lastName: string;
  subtitle?: string;
  /** Server connection, shown as a dot on the avatar. */
  serverStatus?: ServerStatus;
  /** Avatar only — for the sidebar's icon rail, where labels do not fit. */
  compact?: boolean;
  className?: string;
}) {
  const fullName = `${firstName} ${lastName}`.trim();
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.trim().toUpperCase();

  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      {/* The connection dot rides the avatar rather than living in a strip of
          its own. It is the only thing the old status bar showed that was not
          already on screen, and a whole band for one dot is not worth the
          vertical space. The state is also spelled out in words at the top of
          the menu — a bare coloured dot is not self-explanatory. */}
      <span className="relative flex shrink-0">
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
        >
          {initials}
        </span>
        {serverStatus && (
          <span
            aria-hidden
            title={STATUS_LABEL[serverStatus]}
            className={cn(
              'absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-card',
              STATUS_DOT[serverStatus],
            )}
          />
        )}
      </span>
      {/* Hidden below sm, and in compact mode: at those widths the labels push
          the rest of the control off the edge, and the avatar alone still
          answers "who am I". The name then comes from the trigger's own
          aria-label, so nothing is lost to a screen reader. */}
      {!compact && (
        <span className="hidden min-w-0 flex-col text-left sm:flex">
          <span className="truncate text-sm font-semibold text-foreground">{fullName}</span>
          {subtitle && <span className="truncate text-sm text-muted-foreground">{subtitle}</span>}
        </span>
      )}
    </span>
  );
}
