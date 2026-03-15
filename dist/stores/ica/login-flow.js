"use strict";
/**
 * Shared Playwright-based ICA login flow.
 *
 * Used by the runtime adapter (`Ica.login()`).
 * Selectors live in one place for easy maintenance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dismissCookieBanner = dismissCookieBanner;
exports.captureCsrfToken = captureCsrfToken;
exports.performLogin = performLogin;
const ICA_LOGIN_FORM_URL = 'https://ims.icagruppen.se/authn/authenticate/IcaCustomers';
/** Dismiss the OneTrust / ICA cookie consent banner if present. */
async function dismissCookieBanner(page) {
    try {
        const selector = 'button:has-text("Godkänn alla cookies"), #onetrust-accept-btn-handler';
        await page.locator(selector).first().click({ timeout: 5000 });
        console.error('Dismissed cookie consent banner.');
        await page.waitForLoadState('networkidle');
    }
    catch {
        // No banner — continue
    }
}
/**
 * Intercept CSRF tokens from outgoing requests.
 * Resolves with the first captured token or empty string after timeout.
 */
function captureCsrfToken(page, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const handler = (req) => {
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
async function performLogin(page, username, password) {
    // 1. Accept cookies
    await dismissCookieBanner(page);
    // 2. Click initial "Logga in"
    await page
        .locator('button:has-text("Logga in"), a:has-text("Logga in"), [data-qa="login-button"]')
        .first()
        .click({ timeout: 15000 });
    try {
        await page.waitForNavigation({ timeout: 15000 });
    }
    catch {
        // Modal-based flow — no navigation expected
    }
    // 3. "Fler inloggningssätt" → "Lösenord"
    await page.locator('button#more-button:has-text("Fler inloggningssätt")').click({ timeout: 15000 });
    await page.locator('a.IcaCustomers:has-text("Lösenord")').click({ timeout: 15000 });
    await page.waitForURL(ICA_LOGIN_FORM_URL, { timeout: 15000 });
    // 4. Fill credentials & submit
    await page.fill('input#userName', username);
    await page.fill('input#password', password);
    await page.locator('button[type="submit"]:has-text("Logga in")').click({ timeout: 10000 });
    await page.waitForNavigation({ timeout: 30000 });
    console.error('Login navigation complete:', page.url());
}
