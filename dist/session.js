"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSession = createSession;
exports.refreshCredentials = refreshCredentials;
exports.dismissCookieBanner = dismissCookieBanner;
exports.authenticateSession = authenticateSession;
exports.closeSession = closeSession;
exports.getSessionUrl = getSessionUrl;
const playwright_1 = require("playwright");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const SESSION_STATE_PATH = path.join(__dirname, '..', '.auth', 'state.json');
/**
 * Launches a temporary browser, navigates to the store page to collect
 * session cookies, then closes the browser. Returns a browser-free session.
 */
async function createSession(storeId) {
    const browser = await playwright_1.chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 },
            locale: 'sv-SE',
            timezoneId: 'Europe/Stockholm',
            extraHTTPHeaders: {
                'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });
        const page = await context.newPage();
        let csrfToken = '';
        const tokenPromise = new Promise((resolve) => {
            page.on('request', (req) => {
                const token = req.headers()['x-csrf-token'];
                if (token)
                    resolve(token);
            });
            setTimeout(() => resolve(''), 5000);
        });
        await page.goto(`https://handlaprivatkund.ica.se/stores/${storeId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });
        await dismissCookieBanner(page);
        csrfToken = await tokenPromise;
        const cookies = await context.cookies('https://handlaprivatkund.ica.se');
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        await page.close();
        await context.close();
        console.error(`Session created. Cookies: ${cookieString.length} chars, CSRF: ${csrfToken ? 'yes' : 'none'}`);
        return { storeId, authenticated: false, cookieString, csrfToken, cookies };
    }
    finally {
        await browser.close();
    }
}
/**
 * Re-launches a temporary browser to capture fresh cookies and CSRF token.
 * Mutates the session in place, then closes the browser.
 */
async function refreshCredentials(session) {
    const browser = await playwright_1.chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 },
            locale: 'sv-SE',
            timezoneId: 'Europe/Stockholm',
            extraHTTPHeaders: {
                'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });
        // Re-inject existing cookies so the authenticated state carries over
        if (session.cookies.length > 0) {
            await context.addCookies(session.cookies);
        }
        const page = await context.newPage();
        let csrfToken = '';
        const tokenPromise = new Promise((resolve) => {
            page.on('request', (req) => {
                const token = req.headers()['x-csrf-token'];
                if (token)
                    resolve(token);
            });
            setTimeout(() => resolve(''), 5000);
        });
        await page.goto(`https://handlaprivatkund.ica.se/stores/${session.storeId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });
        csrfToken = await tokenPromise;
        const cookies = await context.cookies('https://handlaprivatkund.ica.se');
        session.cookies = cookies;
        session.cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        session.csrfToken = csrfToken || session.csrfToken;
        await page.close();
        await context.close();
        console.error(`Credentials refreshed. Cookies: ${session.cookieString.length} chars, CSRF: ${session.csrfToken ? 'yes' : 'none'}`);
    }
    finally {
        await browser.close();
    }
}
/**
 * Dismisses the OneTrust cookie consent banner if present on the page.
 */
async function dismissCookieBanner(page) {
    try {
        const cookieBtn = page.locator('#onetrust-accept-btn-handler');
        await cookieBtn.click({ timeout: 3000 });
        console.error('Dismissed cookie consent banner.');
        await page.waitForTimeout(500);
    }
    catch {
        // No cookie banner — continue
    }
}
/**
 * Authenticates using a temporary browser, extracts cookies, then closes it.
 */
async function authenticateSession(session, username, password) {
    const browser = await playwright_1.chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 },
            locale: 'sv-SE',
            timezoneId: 'Europe/Stockholm',
            extraHTTPHeaders: {
                'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });
        // Re-inject existing cookies
        if (session.cookies.length > 0) {
            await context.addCookies(session.cookies);
        }
        const page = await context.newPage();
        // Listen for CSRF token on any outgoing request
        let csrfToken = '';
        const tokenPromise = new Promise((resolve) => {
            page.on('request', (req) => {
                const token = req.headers()['x-csrf-token'];
                if (token)
                    resolve(token);
            });
            setTimeout(() => resolve(''), 10000);
        });
        await page.goto('https://www.ica.se/', { waitUntil: 'domcontentloaded' });
        // Accept cookies if prompted
        try {
            const cookieBtn = page.locator('button:has-text("Godkänn alla cookies"), #onetrust-accept-btn-handler');
            await cookieBtn.first().click({ timeout: 5000 });
            console.error('Accepted cookies.');
            await page.waitForLoadState('networkidle');
        }
        catch {
            // No cookie banner — continue
        }
        // Click initial "Logga in" button
        const loginBtn = page.locator('button:has-text("Logga in"), a:has-text("Logga in"), [data-qa="login-button"]');
        await loginBtn.first().click({ timeout: 15000 });
        console.error('Clicked "Logga in".');
        try {
            await page.waitForNavigation({ timeout: 15000 });
        }
        catch {
            // Modal or in-page change
        }
        // Click "Fler inloggningssätt"
        await page.locator('button#more-button:has-text("Fler inloggningssätt")').click({ timeout: 15000 });
        console.error('Clicked "Fler inloggningssätt".');
        // Click "Lösenord"
        await page.locator('a.IcaCustomers:has-text("Lösenord")').click({ timeout: 15000 });
        console.error('Clicked "Lösenord".');
        await page.waitForURL('https://ims.icagruppen.se/authn/authenticate/IcaCustomers', { timeout: 15000 });
        // Fill and submit login form
        await page.fill('input#userName', username);
        await page.fill('input#password', password);
        await page.locator('button[type="submit"]:has-text("Logga in")').click({ timeout: 10000 });
        console.error('Submitted login form.');
        await page.waitForNavigation({ timeout: 30000 });
        console.error('Login navigation complete:', page.url());
        // Navigate to the store to bind the authenticated session
        const storeUrl = `https://handlaprivatkund.ica.se/stores/${session.storeId}`;
        console.error(`Navigating to store to bind session: ${storeUrl}`);
        await page.goto(storeUrl, { waitUntil: 'load', timeout: 30000 });
        await page.waitForLoadState('networkidle');
        if (page.url().includes('chooseStore')) {
            console.error(`Redirected to chooseStore. Re-navigating to store: ${storeUrl}`);
            await page.goto(storeUrl, { waitUntil: 'load', timeout: 30000 });
            await page.waitForLoadState('networkidle');
        }
        await dismissCookieBanner(page);
        console.error('Store session established:', page.url());
        // Save session state for future reuse
        const authDir = path.dirname(SESSION_STATE_PATH);
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }
        await context.storageState({ path: SESSION_STATE_PATH });
        // Extract cookies and CSRF
        const cookies = await context.cookies('https://handlaprivatkund.ica.se');
        session.cookies = cookies;
        session.cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        csrfToken = await tokenPromise;
        if (csrfToken) {
            session.csrfToken = csrfToken;
        }
        session.authenticated = true;
        console.error(`Session state saved. Authentication successful.`);
        console.error(`Post-auth CSRF: ${session.csrfToken ? 'yes' : 'none'}`);
        await page.close();
        await context.close();
    }
    finally {
        await browser.close();
    }
}
/**
 * No-op — browser is already closed after each operation.
 */
async function closeSession(_session) {
    // Nothing to close — browsers are ephemeral now.
}
/**
 * Returns the store/cart URLs and exports session cookies.
 * No browser needed — uses stored cookie data.
 */
async function getSessionUrl(session) {
    const icaCookies = session.cookies
        .filter(c => c.domain.includes('ica.se'))
        .map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite === 'Lax' ? 'lax' : c.sameSite === 'Strict' ? 'strict' : 'no_restriction',
        ...(c.expires > 0 ? { expirationDate: c.expires } : {}),
    }));
    return {
        storeUrl: `https://handlaprivatkund.ica.se/stores/${session.storeId}`,
        cartUrl: `https://handlaprivatkund.ica.se/stores/${session.storeId}/basket`,
        authenticated: session.authenticated,
        cookies: icaCookies,
    };
}
