"use strict";
/**
 * ICA grocery store adapter.
 *
 * Implements the GroceryStore interface by combining session management,
 * HTTP API calls, and Playwright-based authentication — all scoped to
 * ICA's handlaprivatkund.ica.se backend.
 */
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
exports.Ica = void 0;
const crypto_1 = require("crypto");
const playwright_1 = require("playwright");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const login_flow_1 = require("./login-flow");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BASE = 'https://handlaprivatkund.ica.se';
const AUTH_DIR = path.join(process.cwd(), '.auth');
const SESSION_STATE_PATH = path.join(AUTH_DIR, 'state.json');
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BROWSER_CONTEXT_OPTIONS = {
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    extraHTTPHeaders: {
        'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
    },
};
// ---------------------------------------------------------------------------
// JSON-LD product list parser (favourites / regulars pages)
// ---------------------------------------------------------------------------
/**
 * Extracts product data from JSON-LD structured data embedded in ICA's
 * server-rendered favourites / regulars HTML pages.
 *
 * Returns sparse `Product` objects (id + name derived from URL slug + productUrl).
 */
function parseJsonLdProducts(html, storeId) {
    // Match the specific <script> tag that holds the product listing JSON-LD.
    const scriptPattern = /<script[^>]*data-test="product-listing-structured-data"[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i;
    const match = scriptPattern.exec(html);
    if (!match?.[1]) {
        return [];
    }
    let parsed;
    try {
        parsed = JSON.parse(match[1]);
    }
    catch {
        console.error('Failed to parse JSON-LD from product listing page.');
        return [];
    }
    if (parsed['@type'] !== 'ItemList' || !Array.isArray(parsed.itemListElement)) {
        return [];
    }
    return parsed.itemListElement
        .filter((item) => typeof item.url === 'string')
        .map((item) => {
        // URL pattern: https://handla.ica.se//stores/{storeId}/products/{slug}/{productId}
        const segments = item.url.replace(/\/+$/, '').split('/');
        const productId = segments[segments.length - 1] ?? '';
        const slug = segments[segments.length - 2] ?? '';
        const name = slug
            .split('-')
            .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ''))
            .join(' ');
        return {
            id: productId,
            name,
            productUrl: `${BASE}/stores/${storeId}/products/${slug}/${productId}`,
        };
    });
}
// ---------------------------------------------------------------------------
// Playwright helper — run a callback inside a fresh browser context
// ---------------------------------------------------------------------------
async function withBrowser(fn, existingCookies) {
    const browser = await playwright_1.chromium.launch({ headless: true });
    try {
        const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
        if (existingCookies?.length) {
            await context.addCookies(existingCookies);
        }
        const page = await context.newPage();
        try {
            return await fn(context, page);
        }
        finally {
            await page.close();
            await context.close();
        }
    }
    finally {
        await browser.close();
    }
}
async function icaFetch(session, urlPath, options = {}, refreshFn) {
    const url = `${BASE}/stores/${session.storeId}${urlPath}`;
    const method = options.method ?? 'GET';
    const expectJson = options.expectJson !== false;
    console.error(`icaFetch ${method} ${url}`);
    const acceptHeader = expectJson
        ? 'application/json; charset=utf-8'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    const buildHeaders = () => ({
        accept: acceptHeader,
        ...(expectJson ? { 'content-type': 'application/json; charset=utf-8' } : {}),
        cookie: session.cookieString,
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        origin: BASE,
        referer: `${BASE}/stores/${session.storeId}`,
        'ecom-request-source': 'web',
        'ecom-request-source-version': '2.0.0',
        'client-route-id': (0, crypto_1.randomUUID)(),
        'page-view-id': (0, crypto_1.randomUUID)(),
        'user-agent': USER_AGENT,
        ...(session.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}),
        ...options.headers,
    });
    const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
    let res = await fetch(url, { method, headers: buildHeaders(), body: bodyStr });
    if (res.status === 401 || res.status === 403) {
        console.error(`Got ${res.status} — refreshing credentials and retrying…`);
        await refreshFn(session);
        res = await fetch(url, { method, headers: buildHeaders(), body: bodyStr });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`ICA API ${method} ${urlPath} failed after retry: ${res.status} ${text}`);
        }
        return res;
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`ICA API ${method} ${urlPath} failed: ${res.status} ${text}`);
    }
    if (expectJson) {
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
            const body = await res.text().catch(() => '');
            console.error(`Non-JSON response (${res.status}, ${contentType}): ${body.slice(0, 200)}`);
            throw new Error(`ICA API ${method} ${urlPath} returned non-JSON response (${contentType}).`);
        }
    }
    return res;
}
// ---------------------------------------------------------------------------
// ICA adapter implementation
// ---------------------------------------------------------------------------
class Ica {
    constructor() {
        this.name = 'ICA';
    }
    requireSession() {
        if (!this.session) {
            throw new Error('No ICA session. Call setStore() first.');
        }
        return this.session;
    }
    async setStore(storeId) {
        await this.close();
        const { csrfToken, cookies, cookieString } = await withBrowser(async (_ctx, page) => {
            const csrfPromise = (0, login_flow_1.captureCsrfToken)(page);
            await page.goto(`${BASE}/stores/${storeId}`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });
            await (0, login_flow_1.dismissCookieBanner)(page);
            const csrf = await csrfPromise;
            const cks = await _ctx.cookies(BASE);
            return {
                csrfToken: csrf,
                cookies: cks,
                cookieString: cks.map((c) => `${c.name}=${c.value}`).join('; '),
            };
        });
        this.session = { storeId, authenticated: false, cookieString, csrfToken, cookies };
        console.error(`ICA session created for store ${storeId}. CSRF: ${csrfToken ? 'yes' : 'none'}`);
    }
    async login(username, password) {
        const session = this.requireSession();
        const { cookies, cookieString, csrfToken } = await withBrowser(async (ctx, page) => {
            const csrfPromise = (0, login_flow_1.captureCsrfToken)(page, 10000);
            await page.goto('https://www.ica.se/', { waitUntil: 'domcontentloaded' });
            await (0, login_flow_1.performLogin)(page, username, password);
            // Bind session to store
            const storeUrl = `${BASE}/stores/${session.storeId}`;
            await page.goto(storeUrl, { waitUntil: 'load', timeout: 30000 });
            await page.waitForLoadState('networkidle');
            if (page.url().includes('chooseStore')) {
                await page.goto(storeUrl, { waitUntil: 'load', timeout: 30000 });
                await page.waitForLoadState('networkidle');
            }
            await (0, login_flow_1.dismissCookieBanner)(page);
            // Persist storage state
            if (!fs.existsSync(AUTH_DIR)) {
                fs.mkdirSync(AUTH_DIR, { recursive: true });
            }
            await ctx.storageState({ path: SESSION_STATE_PATH });
            const cks = await ctx.cookies(BASE);
            return {
                cookies: cks,
                cookieString: cks.map((c) => `${c.name}=${c.value}`).join('; '),
                csrfToken: await csrfPromise,
            };
        }, session.cookies);
        session.cookies = cookies;
        session.cookieString = cookieString;
        if (csrfToken)
            session.csrfToken = csrfToken;
        session.authenticated = true;
        console.error('ICA login successful.');
    }
    async searchProducts(query) {
        const session = this.requireSession();
        const params = new URLSearchParams({
            includeAdditionalPageInfo: 'false',
            maxPageSize: '10',
            maxProductsToDecorate: '10',
            q: query,
            tag: 'web',
        });
        const res = await this.fetch(`/api/webproductpagews/v6/product-pages/search?${params}`);
        const data = await res.json();
        return (data.productGroups ?? [])
            .flatMap((g) => g.decoratedProducts ?? [])
            .map((r) => {
            const productId = String(r.productId ?? '');
            const retailerId = String(r.retailerProductId ?? '');
            const priceAmount = r.promoPrice?.amount ?? r.price?.amount;
            return {
                id: productId,
                name: String(r.name ?? 'Unknown'),
                price: priceAmount != null ? `${priceAmount} ${r.price?.currency ?? 'SEK'}` : undefined,
                unit: r.packSizeDescription ?? undefined,
                imageUrl: r.image?.src ?? undefined,
                productUrl: retailerId
                    ? `${BASE}/stores/${session.storeId}/products/${retailerId}`
                    : undefined,
            };
        });
    }
    async addToCart(productId, quantity) {
        return this.applyQuantity(productId, quantity);
    }
    async removeFromCart(productId, quantity) {
        const cart = await this.getCart();
        const currentQty = cart.items.find((i) => i.productId === productId)?.quantity ?? 0;
        if (currentQty === 0) {
            return { success: true, message: `Product ${productId} is not in the cart.` };
        }
        const toRemove = Math.min(quantity, currentQty);
        const result = await this.applyQuantity(productId, -toRemove);
        if (!result.success)
            return result;
        return toRemove >= currentQty
            ? { success: true, message: `Product ${productId} removed from cart.` }
            : { success: true, message: `Product ${productId} quantity reduced by ${toRemove} (now ${currentQty - toRemove}).` };
    }
    async getCart() {
        this.requireSession();
        const res = await this.fetch('/api/cart/v1/carts/active');
        const data = await res.json();
        const items = (data.items ?? []).map((r) => ({
            productId: String(r.productId ?? ''),
            name: String(r.name ?? r.productName ?? 'Unknown'),
            price: r.finalPrice?.amount != null
                ? `${r.finalPrice.amount} ${r.finalPrice.currency ?? 'SEK'}`
                : undefined,
            quantity: Number(r.quantity ?? 0),
            productUrl: undefined,
            imageUrl: undefined,
        }));
        const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
        const totalPrice = data.totals?.itemPriceAfterPromos?.amount != null
            ? `${data.totals.itemPriceAfterPromos.amount} ${data.totals.itemPriceAfterPromos.currency ?? 'SEK'}`
            : undefined;
        return { items, totalItems, totalPrice };
    }
    async close() {
        this.session = undefined;
    }
    async getFavourites() {
        return this.fetchProductList('/favorites');
    }
    async getPurchaseHistory() {
        return this.fetchProductList('/regulars');
    }
    // --- internal helpers ----------------------------------------------------
    /**
     * Fetches a server-rendered ICA page (favourites or regulars) and extracts
     * product data from the embedded JSON-LD structured data.
     */
    async fetchProductList(pagePath) {
        const session = this.requireSession();
        const res = await this.fetch(pagePath, { expectJson: false });
        const html = await res.text();
        return parseJsonLdProducts(html, session.storeId);
    }
    async applyQuantity(productId, quantity) {
        try {
            const body = [{ productId, quantity }];
            console.error(`apply-quantity: ${JSON.stringify(body)}`);
            const res = await this.fetch('/api/cart/v1/carts/active/apply-quantity', {
                method: 'POST',
                body,
            });
            await res.json();
            return { success: true, message: `Product ${productId} quantity adjusted by ${quantity}.` };
        }
        catch (error) {
            return {
                success: false,
                message: `Failed to set quantity for ${productId}: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    async refreshCredentials(session) {
        const { cookies, cookieString, csrfToken } = await withBrowser(async (ctx, page) => {
            const csrfPromise = (0, login_flow_1.captureCsrfToken)(page);
            await page.goto(`${BASE}/stores/${session.storeId}`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });
            const cks = await ctx.cookies(BASE);
            return {
                cookies: cks,
                cookieString: cks.map((c) => `${c.name}=${c.value}`).join('; '),
                csrfToken: await csrfPromise,
            };
        }, session.cookies);
        session.cookies = cookies;
        session.cookieString = cookieString;
        session.csrfToken = csrfToken || session.csrfToken;
        console.error(`ICA credentials refreshed. CSRF: ${session.csrfToken ? 'yes' : 'none'}`);
    }
    fetch(urlPath, options = {}) {
        const session = this.requireSession();
        return icaFetch(session, urlPath, options, (s) => this.refreshCredentials(s));
    }
}
exports.Ica = Ica;
