'use client';

import { MODULE_LABELS, RESOURCE_LABELS, ACTION_LABELS, type PermissionDefinition } from '@erp/shared';

interface PermissionEditorProps {
  catalog: PermissionDefinition[];
  selected: Set<string>;
  onToggle: (code: string) => void;
  disabled?: boolean;
}

/**
 * Grouped permission checkboxes (module → resource → action), never a
 * flat list of raw codes — see CLAUDE.md ("an administrator should be
 * able to answer 'what can this role do' without needing to understand
 * database concepts"). The raw code is available as a `title` tooltip
 * for anyone who wants it, secondary to the Spanish label.
 */
export function PermissionEditor({ catalog, selected, onToggle, disabled }: PermissionEditorProps) {
  const modules = new Map<string, Map<string, PermissionDefinition[]>>();
  for (const permission of catalog) {
    if (!modules.has(permission.module)) modules.set(permission.module, new Map());
    const resources = modules.get(permission.module)!;
    if (!resources.has(permission.resource)) resources.set(permission.resource, []);
    resources.get(permission.resource)!.push(permission);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...modules.entries()].map(([moduleKey, resources]) => (
        <div key={moduleKey} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{MODULE_LABELS[moduleKey] ?? moduleKey}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...resources.entries()].map(([resourceKey, permissions]) => (
              <div key={resourceKey} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {RESOURCE_LABELS[resourceKey] ?? resourceKey}
                </p>
                <div className="flex flex-col gap-1.5">
                  {permissions.map((permission) => (
                    <label
                      key={permission.code}
                      className="flex items-center gap-2 text-sm"
                      title={permission.code}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(permission.code)}
                        onChange={() => onToggle(permission.code)}
                        disabled={disabled}
                        className="size-4 rounded border-border"
                      />
                      {ACTION_LABELS[permission.action] ?? permission.action}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
