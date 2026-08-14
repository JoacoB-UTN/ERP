import { AppShell } from '@/components/layout/app-shell';
import { fetchHealth } from '@/lib/api';

const STATUS_LABEL: Record<string, string> = {
  ok: 'System operational',
  degraded: 'System operational (degraded)',
  error: 'System unavailable',
};

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  error: 'bg-red-500',
};

export default async function Home() {
  const health = await fetchHealth();

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">ERP</h1>
          <div className="mt-2 flex items-center gap-2 text-muted-foreground">
            <span className={`size-2 rounded-full ${STATUS_DOT[health.status]}`} />
            <span>{STATUS_LABEL[health.status]}</span>
          </div>
        </div>

        <dl className="grid max-w-sm grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border p-4 text-sm">
          <dt className="text-muted-foreground">Database</dt>
          <dd className="font-medium">{health.services.database}</dd>
          <dt className="text-muted-foreground">Redis</dt>
          <dd className="font-medium">{health.services.redis}</dd>
        </dl>
      </div>
    </AppShell>
  );
}
