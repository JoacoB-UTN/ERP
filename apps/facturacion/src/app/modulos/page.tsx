'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { CompanySummary } from '@erp/shared';
import { useMe, useActiveCompany, usePermissions, useLogout } from '@/lib/auth-client';
import { workspaceModules, type WorkspaceModule } from '@/lib/modules';
import { LogoMark } from '@/components/brand/logo-mark';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { SessionControl } from '@/components/layout/session-control';

/**
 * Post-login module picker.
 *
 * Deliberately OUTSIDE the (app) route group: that group's layout requires
 * apps.facturacion.access, and a user who only has Gestión must still be able
 * to land here and be sent on. Gating this screen the same way would dead-end
 * exactly the people it exists to help.
 *
 * Which modules appear comes from the permissions of the ACTIVE COMPANY — the
 * same grant the destination app checks on arrival — so company resolution has
 * to happen first. It uses this screen's own presentation rather than the
 * shell's `SelectCompanyPrompt`, which is built to sit inside the app chrome
 * and would look unrelated to the login it follows.
 *
 * This screen decides what to offer. It is not a security boundary: the backend
 * enforces every real operation regardless of what is rendered here.
 */
export default function ModulePickerPage() {
  const router = useRouter();
  const { data, isLoading, isError } = useMe();
  const companyCtx = useActiveCompany();
  const permissions = usePermissions();
  const logout = useLogout();

  const companyResolved = !!companyCtx.activeCompanyId;
  const ready = !isLoading && !isError && !!data && companyResolved && !permissions.isLoading;
  const available = ready ? workspaceModules().filter((m) => permissions.can(m.permission)) : [];
  // With one module there is no decision to make, so the picker would only add
  // a click to every single login. Resolved in an effect, not during render,
  // because it navigates.
  const onlyModule = ready && available.length === 1 ? available[0] : null;

  useEffect(() => {
    if (isError) router.replace('/login');
  }, [isError, router]);

  useEffect(() => {
    if (!onlyModule) return;
    if (onlyModule.isCurrentApp) {
      router.replace(onlyModule.href);
    } else {
      // A different origin (the sibling workspace's port), so this cannot go
      // through the Next router. `replace` keeps the picker out of history:
      // pressing Back should not bounce the user through it again.
      window.location.replace(onlyModule.href);
    }
  }, [onlyModule, router]);

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  const session = data
    ? {
        firstName: data.user.firstName,
        lastName: data.user.lastName,
        companyName: companyCtx.activeCompany?.tradeName ?? companyCtx.activeCompany?.legalName,
        // Omitted with a single company: there is nothing to switch to, and an
        // action that cannot do anything is worse than no action.
        onChangeCompany:
          companyCtx.companies.length > 1 ? () => companyCtx.setActiveCompany(null) : undefined,
        onLogout: handleLogout,
        logoutPending: logout.isPending,
      }
    : undefined;

  // Blank rather than a spinner: normally brief, and avoids flashing a picker
  // for a session or a permission set that is about to resolve differently.
  if (isLoading || isError || !data || onlyModule) {
    return <div className="min-h-screen bg-background" />;
  }

  if (companyCtx.hasNoCompanies) {
    return (
      <Screen session={session}>
        <Heading title="Sin empresas habilitadas" />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Pedile a un administrador que te dé acceso a una empresa para poder continuar.
        </p>
      </Screen>
    );
  }

  if (companyCtx.needsSelection) {
    return (
      <Screen session={session}>
        <Heading title="Elegí una empresa" />
        {/* min-w because the wrapper shrinks to its content: without a floor the
            company rows would collapse to the width of the longest name. */}
        <ul className="mt-8 flex w-full min-w-[280px] flex-col gap-2">
          {companyCtx.companies.map((company) => (
            <li key={company.id}>
              <CompanyButton
                company={company}
                onSelect={() => companyCtx.setActiveCompany(company.id)}
              />
            </li>
          ))}
        </ul>
      </Screen>
    );
  }

  if (permissions.isLoading) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <Screen session={session}>
      <LogoMark />
      {available.length === 0 ? (
        <p className="mt-8 max-w-prose text-center text-sm text-muted-foreground">
          No tenés módulos habilitados en esta empresa. Pedile a un administrador que te dé acceso.
        </p>
      ) : (
        <ul className="mt-8 flex flex-wrap justify-center gap-3">
          {available.map((module) => (
            <li key={module.id}>
              <ModuleTile module={module} />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

/**
 * Centred column that shrinks to its content.
 *
 * `w-fit` matters: it makes the block's left edge the tile grid's own left
 * edge, so anything below can sit in that corner while the whole thing stays
 * centred. Against a fixed-width column it would drift far to the left of the
 * tiles whenever there are only one or two.
 */
function Screen({
  session,
  children,
}: {
  session?: React.ComponentProps<typeof SessionControl>;
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="absolute top-4 right-4">
        {session ? <SessionControl {...session} /> : <ThemeToggle />}
      </div>
      <div className="flex w-fit max-w-full flex-col items-center">{children}</div>
    </main>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <LogoMark />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

/**
 * Shared row surface so picking a company and picking a module read as the same
 * kind of choice — they are consecutive steps of one flow.
 */
const ROW_CLASS =
  'flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors outline-none hover:border-ring hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

/**
 * A 112px tile: icon above, name below-left.
 *
 * A plain <a> even for this app's own route — picking a module is a full entry
 * into a workspace, and both destinations should behave identically.
 *
 * The label lives inside the coloured square rather than under it so the tile
 * is one object, not an icon with a caption; at this size that is the
 * difference between a grid that scans in one pass and one the eye has to
 * assemble.
 *
 * Sized against the label, not by eye: "Facturación" is the longest name and
 * measures 66px in Geist at 12px, against 92px of usable width here. At the
 * first attempt — a 64px tile with a 10px label — it needed 55px against 52px
 * and broke mid-word into "Facturació / n", so the ratio between tile size and
 * label size is load-bearing, not decorative.
 */
function ModuleTile({ module }: { module: WorkspaceModule }) {
  const Icon = module.icon;
  return (
    <a
      href={module.href}
      title={module.description}
      // The chart tokens invert between themes — dark blue/green on light,
      // light blue/green on dark — so a fixed white glyph would lose contrast
      // in dark mode. The tile's content takes the page background instead.
      className={`flex size-28 flex-col justify-between rounded-lg p-2.5 text-white transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:text-background ${module.tileClassName}`}
    >
      <Icon className="size-7" />
      <span className="text-xs leading-tight font-medium break-words">{module.name}</span>
    </a>
  );
}

function CompanyButton({ company, onSelect }: { company: CompanySummary; onSelect: () => void }) {
  const label = company.tradeName ?? company.legalName;
  return (
    <button type="button" onClick={onSelect} className={ROW_CLASS}>
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-secondary-foreground"
      >
        {label.slice(0, 2).toUpperCase()}
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </button>
  );
}
