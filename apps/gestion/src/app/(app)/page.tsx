import { fetchHealth } from '@/lib/api';

const STATUS_LABEL: Record<string, string> = {
  ok: 'Sistema operativo',
  degraded: 'Sistema operativo (degradado)',
  error: 'Sistema no disponible',
};

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  error: 'bg-red-500',
};

export default async function DashboardPage() {
  const health = await fetchHealth();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Bienvenido</h1>
        <div className="mt-2 flex items-center gap-2 text-muted-foreground">
          <span className={`size-2 rounded-full ${STATUS_DOT[health.status]}`} />
          <span>{STATUS_LABEL[health.status]}</span>
        </div>
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">
        Todavía no hay módulos de negocio instalados. Esta es la base autenticada de Gestión — el backoffice
        del ERP.
      </p>
    </div>
  );
}
