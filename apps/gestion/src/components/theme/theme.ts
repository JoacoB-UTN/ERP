'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const COOKIE_NAME = 'erp-theme';
/** One year. Long enough that the choice reads as permanent. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Runs before hydration, from the root layout.
 *
 * Without it the server's markup carries the light palette and the class only
 * lands after hydration, so a user on dark sees a white flash on every load.
 * It is inlined as a string on purpose: anything imported would run too late.
 *
 * The choice is kept in a COOKIE rather than localStorage because Gestión and
 * Facturación are served from the same host on different ports. localStorage is
 * scoped per origin, so the port makes them two separate stores and the theme
 * would not survive moving between the two workspaces; cookies ignore the port,
 * so one choice covers the whole product — the same reason the session cookie
 * already works across both.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${COOKIE_NAME}=(light|dark)/);var t=m?m[1]:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()`;

/**
 * The active theme lives on `<html>`, written by the boot script above before
 * React exists. That makes it external state, so it is read with
 * `useSyncExternalStore` rather than mirrored into `useState` — mirroring it
 * would mean writing state from an effect, which React flags as a cascading
 * render, and would briefly disagree with the DOM that is already painted.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * The server cannot know the viewer's theme; it renders light, and the first
 * client snapshot corrects anything that depends on it. Only the toggle's own
 * icon does, so the correction is invisible.
 */
function getServerSnapshot(): Theme {
  return 'light';
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = useCallback(() => {
    const next: Theme = document.documentElement.classList.contains('dark')
      ? 'light'
      : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    // Not HttpOnly on purpose: the boot script has to read it before any
    // JavaScript bundle loads. It carries a display preference, nothing
    // security-relevant. SameSite=Lax keeps it off cross-site requests.
    document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    for (const listener of listeners) listener();
  }, []);

  return { theme, toggleTheme };
}
