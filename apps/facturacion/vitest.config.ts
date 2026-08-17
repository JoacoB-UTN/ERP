import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // The app's own tsconfig sets `jsx: "preserve"` (Next.js transforms JSX
  // itself at build time) — Vitest's esbuild transform needs an explicit
  // runtime instead, or `.tsx` test files fail with "React is not defined".
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    // Pure-logic tests (*.test.ts) run in 'node' — fast, no DOM needed.
    // Component tests (*.test.tsx) need a DOM, so they get their own
    // 'jsdom' project. `extends: true` inherits the esbuild/resolve
    // config above into both.
    projects: [
      { extends: true, test: { name: 'logic', environment: 'node', include: ['src/**/*.test.ts'] } },
      { extends: true, test: { name: 'components', environment: 'jsdom', include: ['src/**/*.test.tsx'] } },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
