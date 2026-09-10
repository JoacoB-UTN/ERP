'use client';

import { Moon, Sun } from 'lucide-react';

import { useTheme } from './theme';
import { Button } from '@/components/ui/button';

/**
 * Light/dark switch.
 *
 * A single button rather than a three-way light/dark/system control: the
 * initial value already follows the OS, so the only thing a user needs here is
 * to override it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggleTheme}
      className={className}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
