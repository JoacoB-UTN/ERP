'use client';

import { useRef } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronDown, Building2, LayoutGrid, LogOut } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SessionBadge, STATUS_LABEL, type ServerStatus } from './session-badge';
import { ThemeToggle } from '@/components/theme/theme-toggle';

/**
 * The session control: who is signed in, which company is active, the actions
 * that belong to that session, and the theme switch — one bordered unit rather
 * than several things that happen to sit near each other.
 *
 * Switching workspace lives in here too. It used to be a permanently visible
 * two-item toggle in the top bar, which spent horizontal space on every screen
 * for something a user does rarely, and only ever offered the two workspaces
 * that exist today — the module picker already knows which ones this user
 * actually has.
 *
 * The menu is `@base-ui/react`'s, the same library every other primitive in
 * this app comes from, so it brings no new dependency and arrives with focus
 * management, Escape/outside-click dismissal and roving keyboard navigation
 * already correct. Hand-rolling a dropdown means reimplementing exactly those
 * parts, and getting them subtly wrong.
 *
 * The theme toggle stays OUTSIDE the menu: it is a switch a user flips and
 * immediately sees the result of, so hiding it behind two clicks would cost
 * more than the row it occupies.
 */
export function SessionControl({
  firstName,
  lastName,
  companyName,
  serverStatus,
  onChangeModule,
  onChangeCompany,
  onLogout,
  logoutPending,
  compact = false,
}: {
  firstName: string;
  lastName: string;
  companyName?: string;
  /** Server connection — a dot on the avatar, spelled out in the menu. */
  serverStatus?: ServerStatus;
  /** Omitted on the module picker itself — you are already there. */
  onChangeModule?: () => void;
  /** Omitted when the user only has one company — nothing to switch to. */
  onChangeCompany?: () => void;
  onLogout: () => void;
  logoutPending: boolean;
  /** Stacked, avatar-only — for the sidebar's collapsed icon rail. */
  compact?: boolean;
}) {
  // The menu is anchored to the whole card, not to its trigger. The trigger is
  // only the badge, so anchoring to it left the popup's edge floating under the
  // middle of the control instead of lining up with it.
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      className={cn(
        'flex rounded-lg border border-border bg-card shadow-sm',
        compact
          ? 'flex-col items-center gap-1 p-1'
          : 'items-center gap-2 py-1.5 pr-1.5 pl-2.5',
      )}
    >
      <Menu.Root>
        <Menu.Trigger
          className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          aria-label={`Opciones de sesión — ${firstName} ${lastName}`}
        >
          <SessionBadge
            firstName={firstName}
            lastName={lastName}
            subtitle={companyName}
            serverStatus={serverStatus}
            compact={compact}
          />
          {!compact && <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            anchor={cardRef}
            side={compact ? 'right' : 'bottom'}
            sideOffset={6}
            align={compact ? 'end' : 'end'}
            className="z-50"
          >
            {/* The exit transition is REQUIRED, not decoration: Base UI keeps the
                popup mounted until its closing transition finishes, so without one
                it stays on screen after `aria-expanded` flips to false. Caught by
                opening and closing it, not by reading the code. */}
            <Menu.Popup className="min-w-52 origin-[var(--transform-origin)] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md transition-[opacity,scale] duration-100 ease-out outline-none data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
              {serverStatus && (
                <>
                  {/* Not a menu item: it is a readout, not something to
                      activate, so it must not take keyboard focus. */}
                  <p
                    role="presentation"
                    className="px-2 py-1.5 text-xs text-muted-foreground"
                  >
                    {STATUS_LABEL[serverStatus]}
                  </p>
                  <div role="separator" className="my-1 h-px bg-border" />
                </>
              )}
              {onChangeModule && (
                <Menu.Item
                  onClick={onChangeModule}
                  className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted"
                >
                  <LayoutGrid className="size-4 text-muted-foreground" />
                  Cambiar módulo
                </Menu.Item>
              )}
              {onChangeCompany && (
                <Menu.Item
                  onClick={onChangeCompany}
                  className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted"
                >
                  <Building2 className="size-4 text-muted-foreground" />
                  Cambiar empresa
                </Menu.Item>
              )}
              <Menu.Item
                onClick={onLogout}
                disabled={logoutPending}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none select-none data-disabled:opacity-50 data-highlighted:bg-destructive-muted"
              >
                <LogOut className="size-4" />
                Cerrar sesión
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <span aria-hidden className={cn('bg-border', compact ? 'h-px w-7' : 'h-7 w-px')} />
      <ThemeToggle />
    </div>
  );
}
