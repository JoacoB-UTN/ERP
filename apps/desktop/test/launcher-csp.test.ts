import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Regression coverage for the launcher's CSP meta tag — see the doc
 * comment right above it in launcher.html. `frame-ancestors` is ignored
 * by browsers/Electron when delivered via <meta> (only a real HTTP
 * response header can enforce it), so including it produced a
 * misleading DevTools warning without doing anything; framing
 * protection for this local page comes from the Electron
 * BrowserWindow/navigation security model instead (see main.ts /
 * navigation-policy.ts), not from this tag.
 */
describe('launcher CSP', () => {
  function readCsp(): string {
    const html = readFileSync(
      path.join(__dirname, '..', 'renderer', 'launcher.html'),
      'utf-8',
    );
    const match = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
    if (!match) throw new Error('CSP meta tag not found in launcher.html');
    return match[1];
  }

  it('does not include frame-ancestors — meta CSP cannot enforce it', () => {
    expect(readCsp()).not.toMatch(/frame-ancestors/);
  });

  it('still restricts framing via frame-src, which meta CSP can enforce', () => {
    expect(readCsp()).toMatch(/frame-src\s+'none'/);
  });

  it('keeps every other directive strict and unchanged', () => {
    const csp = readCsp();
    expect(csp).toMatch(/default-src\s+'none'/);
    expect(csp).toMatch(/script-src\s+'self'/);
    expect(csp).toMatch(/connect-src\s+'none'/);
    expect(csp).toMatch(/object-src\s+'none'/);
    expect(csp).toMatch(/base-uri\s+'none'/);
    expect(csp).toMatch(/form-action\s+'none'/);
    // No inline script/eval allowance anywhere in the policy.
    expect(csp).not.toMatch(/unsafe-inline/);
    expect(csp).not.toMatch(/unsafe-eval/);
  });
});
