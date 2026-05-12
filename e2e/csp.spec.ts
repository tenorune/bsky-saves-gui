import { test, expect } from '@playwright/test';

// No CSP violations during route navigation. Catches regressions where
// the bundle starts loading an off-origin asset or evaling a script the
// declared CSP doesn't permit. The CSP is set in index.html via
// <meta http-equiv="Content-Security-Policy">.

test('no CSP violations across route navigation', async ({ page }) => {
  type Violation = {
    blockedURI: string;
    violatedDirective: string;
    documentURI: string;
  };

  const violations: Violation[] = [];

  await page.exposeBinding('__reportCspViolation', (_source, v: Violation) => {
    violations.push(v);
  });

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // The exposed binding is added to window by Playwright.
      const w = window as unknown as { __reportCspViolation: (v: unknown) => void };
      w.__reportCspViolation({
        blockedURI: e.blockedURI,
        violatedDirective: e.violatedDirective,
        documentURI: e.documentURI,
      });
    });
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.goto('/#/privacy');
  await page.waitForLoadState('networkidle');

  await page.goto('/#/settings');
  await page.waitForLoadState('networkidle');

  expect(
    violations,
    `CSP violations observed:\n${JSON.stringify(violations, null, 2)}`,
  ).toEqual([]);
});
