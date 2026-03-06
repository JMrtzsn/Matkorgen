/**
 * Shared Playwright-based ICA login flow.
 *
 * Used by both the standalone auth script (`auth.ts`) and the
 * runtime adapter (`Ica.login()`), so the selectors live in one place.
 */

import { Page } from 'playwright';

const ICA_LOGIN_FORM_URL = 'https://ims.icagruppen.se/authn/authenticate/IcaCustomers';

/** Dismiss the OneTrust / ICA cookie consent banner if present. */
export async function dismissCookieBanner(page: Page): Promise<void> {
  try {
    const selector = 'button:has-text("Godkänn alla cookies"), #onetrust-accept-btn-handler';
    await page.locator(selector).first().click({ timeout: 5000 });
    console.error('Dismissed cookie consent banner.');
    await page.waitForLoadState('networkidle');
  } catch {
    // No banner — continue
  }
}

/**
 * Intercept CSRF tokens from outgoing requests.
 * Resolves with the first captured token or empty string after timeout.
 */
export function captureCsrfToken(page: Page, timeoutMs = 5000): Promise<string> {
  return new Promise<string>((resolve) => {
    const handler = (req: { headers: () => Record<string, string> }) => {
      const token = req.headers()['x-csrf-token'];
      if (token) {
        resolve(token);
      }
    };
    page.on('request', handler);
    setTimeout(() => {
      console.error('CSRF token capture timed out — proceeding without token.');
      resolve('');
    }, timeoutMs);
  });
}

/**
 * Drive the full ICA username/password login flow on the given page.
 *
 * Pre-conditions:
 *   - The page should be at https://www.ica.se/ (or any ICA domain).
 *
 * Post-conditions:
 *   - The browser context holds authenticated cookies.
 */
export async function performLogin(page: Page, username: string, password: string): Promise<void> {
  // 1. Accept cookies
  await dismissCookieBanner(page);

  // 2. Click initial "Logga in"
  await page
    .locator('button:has-text("Logga in"), a:has-text("Logga in"), [data-qa="login-button"]')
    .first()
    .click({ timeout: 15_000 });

  try {
    await page.waitForNavigation({ timeout: 15_000 });
  } catch {
    // Modal-based flow — no navigation expected
  }

  // 3. "Fler inloggningssätt" → "Lösenord"
  await page.locator('button#more-button:has-text("Fler inloggningssätt")').click({ timeout: 15_000 });
  await page.locator('a.IcaCustomers:has-text("Lösenord")').click({ timeout: 15_000 });
  await page.waitForURL(ICA_LOGIN_FORM_URL, { timeout: 15_000 });

  // 4. Fill credentials & submit
  await page.fill('input#userName', username);
  await page.fill('input#password', password);
  await page.locator('button[type="submit"]:has-text("Logga in")').click({ timeout: 10_000 });
  await page.waitForNavigation({ timeout: 30_000 });

  console.error('Login navigation complete:', page.url());
}


