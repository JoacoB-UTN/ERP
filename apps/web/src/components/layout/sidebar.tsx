import { Building2 } from 'lucide-react';

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <Building2 className="size-5" />
        <span className="text-sm font-semibold tracking-tight">ERP Platform</span>
      </div>
      <nav className="flex-1 px-2 py-4">
        <p className="px-2 text-xs font-medium text-muted-foreground">No modules installed yet.</p>
      </nav>
    </aside>
  );
}
