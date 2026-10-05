'use client';

import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

/**
 * Inlined in <head> so the page paints in the right theme: the saved choice, otherwise
 * the system setting, which it keeps following until the visitor picks one.
 */
export const THEME_SCRIPT = `(() => {
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const saved = () => { try { return localStorage.getItem('${STORAGE_KEY}'); } catch { return null; } };
  const apply = () => {
    const choice = saved();
    root.dataset.theme = choice === 'light' || choice === 'dark' ? choice : system.matches ? 'dark' : 'light';
  };
  apply();
  system.addEventListener('change', apply);
})();`;

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing can refuse storage; the choice still applies to this page.
  }
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** The theme in effect, re-rendering when it changes. Light during server rendering. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => 'light',
  );
}
