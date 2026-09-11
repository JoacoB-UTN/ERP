'use client';

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'erp-sidebar-collapsed';

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private mode or blocked storage: treat as expanded.
    return false;
  }
}

/**
 * The server cannot know a per-browser preference, so it renders the panel
 * expanded and the first client snapshot corrects it.
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Whether the side panel is collapsed to its icon rail, remembered per browser.
 *
 * Read through `useSyncExternalStore` rather than a `useState` initialiser.
 * The initialiser version read localStorage during the first render, which the
 * server had no way to match — React reported a hydration failure wherever the
 * panel was server-rendered. This is the sanctioned way to read state that
 * lives outside React, and it also keeps the value in sync across every
 * component that asks for it.
 */
export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleCollapsed = useCallback(() => {
    const next = !getSnapshot();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Private mode or blocked storage: the choice just won't survive a
      // reload, which beats breaking the toggle.
    }
    for (const listener of listeners) listener();
  }, []);

  return { collapsed, toggleCollapsed };
}
