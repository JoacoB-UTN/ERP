import { describe, it, expect } from 'vitest';
import * as esbuild from 'esbuild';
import path from 'node:path';

/**
 * Regression test for the launcher-window blank-screen bug: a sandboxed
 * Electron preload script (`sandbox: true`, required by
 * docs/desktop-lan-architecture.md's security model) can only `require()`
 * a small allow-list of built-ins — NOT arbitrary local CommonJS sibling
 * files. `preload.ts` previously imported `./ipc-channels` as a real
 * runtime value; the compiled `dist/preload.js` then failed to load at
 * all under `sandbox: true` ("module not found: ./ipc-channels"),
 * `window.erp` was never defined, and the launcher's `init()` threw
 * before ever revealing the config/home screen — only the static "ERP"
 * header was visible. Fixed by bundling the preload with esbuild
 * (`npm run build:preload`, see package.json) into one self-contained
 * file with no local `require()`s. This test builds the SAME source
 * with the SAME flags the real build uses, in memory, and asserts the
 * result is actually self-contained — so a future preload change that
 * reintroduces an unbundled local import fails here, not silently at
 * runtime in a packaged app.
 */
describe('preload bundle self-containment', () => {
  const preloadEntry = path.join(__dirname, '..', 'src', 'preload.ts');

  function bundlePreload(): string {
    const result = esbuild.buildSync({
      entryPoints: [preloadEntry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      write: false,
    });
    expect(result.errors).toEqual([]);
    expect(result.outputFiles).toHaveLength(1);
    return result.outputFiles[0].text;
  }

  it('contains no require() of a relative local module — only `require("electron")` may remain unbundled', () => {
    const code = bundlePreload();
    const relativeRequires = code.match(/require\(["']\.[^"']*["']\)/g) ?? [];
    expect(relativeRequires).toEqual([]);
  });

  it('keeps "electron" as the one external require, exactly as the real build script configures it', () => {
    const code = bundlePreload();
    expect(code).toMatch(/require\(["']electron["']\)/);
  });

  it('actually inlines ./ipc-channels — proves the fix is real bundling, not just "no error, empty output"', () => {
    const code = bundlePreload();
    // A real IPC channel string from ipc-channels.ts — only present if
    // that module's contents were genuinely inlined into the bundle.
    expect(code).toContain('erp:get-desktop-config');
  });

  it('still calls contextBridge.exposeInMainWorld — the bundle did not silently lose the actual preload behavior', () => {
    const code = bundlePreload();
    expect(code).toContain('exposeInMainWorld');
  });
});
