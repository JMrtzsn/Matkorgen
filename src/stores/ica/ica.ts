/**
 * ICA grocery store adapter.
 *
 * Implements the GroceryStore interface by combining session management,
 * HTTP API calls, and Playwright-based authentication — all scoped to
 * ICA's handlaprivatkund.ica.se backend.
 */

import { randomUUID } from 'crypto';
import { chromium, Cookie } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

import type {
  GroceryStore,
  Product,
  CartItem,
  CartContents,
} from '../types';

import {
  dismissCookieBanner,
  captureCsrfToken,
  performLogin,
} from './login-flow';

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface IcaSessionState {
  storeId: string;
  authenticated: boolean;
  cookieString: string;
  csrfToken: string;
  cookies: Cookie[];
}

const BASE = 'https://handlaprivatkund.ica.se';
const SESSION_STATE_PATH = path.join(__dirname, '..', '..', '.auth', 'state.json');

// ---------------------------------------------------------------------------
// ICA API response shapes (best-effort based on observed responses)
// ---------------------------------------------------------------------------

interface IcaPrice {
  amount?: number;
  currency?: string;
}

interface IcaProductImage {
  src?: string;
}

interface IcaDecoratedProduct {
  productId?: string | number;
  retailerProductId?: string | number;
  name?: string;
  promoPrice?: IcaPrice;
  price?: IcaPrice;
  packSizeDescription?: string;
  image?: IcaProductImage;
}

interface IcaProductGroup {
  decoratedProducts?: IcaDecoratedProduct[];
}

interface IcaSearchResponse {
  productGroups?: IcaProductGroup[];
}

interface IcaCartItemResponse {
  productId?: string | number;
  name?: string;
  productName?: string;
  finalPrice?: IcaPrice;
  quantity?: number;
}

interface IcaCartTotals {
  itemPriceAfterPromos?: IcaPrice;
}

interface IcaCartResponse {
  items?: IcaCartItemResponse[];
  totals?: IcaCartTotals;
}

// ---------------------------------------------------------------------------
// Playwright helpers (shared browser config)
// ---------------------------------------------------------------------------

const BROWSER_CONTEXT_OPTIONS = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 } as const,
  locale: 'sv-SE',
  timezoneId: 'Europe/Stockholm',
  extraHTTPHeaders: {
    'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
  },
};

// ---------------------------------------------------------------------------
// HTTP helper — ICA-specific fetch with auto-retry on 401/403
// ---------------------------------------------------------------------------

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

async function icaFetch(
  session: IcaSessionState,
  urlPath: string,
  options: FetchOptions = {},
  refreshFn: (s: IcaSessionState) => Promise<void>,
): Promise<Response> {
  const url = `${BASE}/stores/${session.storeId}${urlPath}`;
  const method = options.method ?? 'GET';
  console.error(`icaFetch ${method} ${url}`);

  const buildHeaders = (): Record<string, string> => ({
    accept: 'application/json; charset=utf-8',
    'content-type': 'application/json; charset=utf-8',
    cookie: session.cookieString,
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    origin: BASE,
    referer: `${BASE}/stores/${session.storeId}`,
    'ecom-request-source': 'web',
    'ecom-request-source-version': '2.0.0',
    'client-route-id': randomUUID(),
    'page-view-id': randomUUID(),
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    ...(session.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}),
    ...options.headers,
  });

  const bodyStr = options.body ? JSON.stringify(options.body) : undefined;

  let res = await fetch(url, { method, headers: buildHeaders(), body: bodyStr });

  // Auto-retry on auth failure
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

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const body = await res.text().catch(() => '');
    console.error(`Non-JSON response (${res.status}, ${contentType}): ${body.slice(0, 200)}`);
    throw new Error(`ICA API ${method} ${urlPath} returned non-JSON response (${contentType}).`);
  }

  return res;
}

// ---------------------------------------------------------------------------
// ICA adapter implementation
// ---------------------------------------------------------------------------

export class Ica implements GroceryStore {
  readonly name = 'ICA';
  private session: IcaSessionState | undefined;

  private requireSession(): IcaSessionState {
    if (!this.session) {
      throw new Error('No ICA session. Call setStore() first.');
    }
    return this.session;
  }

  // --- lifecycle -----------------------------------------------------------

  async setStore(storeId: string): Promise<void> {
    // Close previous session (no-op currently, but keeps the contract).
    await this.close();

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
      const page = await context.newPage();
      const csrfPromise = captureCsrfToken(page);

      await page.goto(`${BASE}/stores/${storeId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await dismissCookieBanner(page);

      const csrfToken = await csrfPromise;
      const cookies = await context.cookies(BASE);
      const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

      await page.close();
      await context.close();

      this.session = { storeId, authenticated: false, cookieString, csrfToken, cookies };
      console.error(`ICA session created for store ${storeId}. CSRF: ${csrfToken ? 'yes' : 'none'}`);
    } finally {
      await browser.close();
    }
  }

  async login(username: string, password: string): Promise<void> {
    const session = this.requireSession();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);

      if (session.cookies.length > 0) {
        await context.addCookies(session.cookies);
      }

      const page = await context.newPage();
      const csrfPromise = captureCsrfToken(page, 10000);

      await page.goto('https://www.ica.se/', { waitUntil: 'domcontentloaded' });

      // Use the shared login flow
      await performLogin(page, username, password);

      // Bind session to store
      const storeUrl = `${BASE}/stores/${session.storeId}`;
      await page.goto(storeUrl, { waitUntil: 'load', timeout: 30000 });
      await page.waitForLoadState('networkidle');

      if (page.url().includes('chooseStore')) {
        await page.goto(storeUrl, { waitUntil: 'load', timeout: 30000 });
        await page.waitForLoadState('networkidle');
      }
      await dismissCookieBanner(page);

      // Persist storage state
      const authDir = path.dirname(SESSION_STATE_PATH);
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }
      await context.storageState({ path: SESSION_STATE_PATH });

      // Extract fresh credentials
      const cookies = await context.cookies(BASE);
      session.cookies = cookies;
      session.cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

      const csrfToken = await csrfPromise;
      if (csrfToken) session.csrfToken = csrfToken;

      session.authenticated = true;
      console.error('ICA login successful.');

      await page.close();
      await context.close();
    } finally {
      await browser.close();
    }
  }

  // --- products & cart -----------------------------------------------------

  async searchProducts(query: string): Promise<Product[]> {
    const session = this.requireSession();
    const params = new URLSearchParams({
      includeAdditionalPageInfo: 'false',
      maxPageSize: '10',
      maxProductsToDecorate: '10',
      q: query,
      tag: 'web',
    });

    const res = await this.fetch(`/api/webproductpagews/v6/product-pages/search?${params}`);
    const data: IcaSearchResponse = await res.json();

    const groups = data.productGroups ?? [];
    const raw = groups.flatMap((g) => g.decoratedProducts ?? []);

    return raw.map((r) => {
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

  async addToCart(
    productId: string,
    quantity: number,
  ): Promise<{ success: boolean; message: string }> {
    return this.applyQuantity(productId, quantity);
  }

  async editCart(
    productId: string,
    targetQuantity: number,
  ): Promise<{ success: boolean; message: string }> {
    const cart = await this.getCart();
    const current = cart.items.find((i) => i.productId === productId);
    const currentQty = current?.quantity ?? 0;
    const delta = targetQuantity - currentQty;

    if (delta === 0) {
      return { success: true, message: `Product ${productId} already at quantity ${targetQuantity}.` };
    }

    const result = await this.applyQuantity(productId, delta);
    if (result.success) {
      if (targetQuantity === 0) {
        return { success: true, message: `Product ${productId} removed from cart.` };
      }
      return { success: true, message: `Product ${productId} quantity set to ${targetQuantity} (was ${currentQty}).` };
    }
    return result;
  }

  async getCart(): Promise<CartContents> {
    this.requireSession();
    const res = await this.fetch('/api/cart/v1/carts/active');
    const data: IcaCartResponse = await res.json();

    const rawItems = data.items ?? [];
    const items: CartItem[] = rawItems.map((r) => ({
      productId: String(r.productId ?? ''),
      name: String(r.name ?? r.productName ?? 'Unknown'),
      price:
        r.finalPrice?.amount != null
          ? `${r.finalPrice.amount} ${r.finalPrice.currency ?? 'SEK'}`
          : undefined,
      quantity: Number(r.quantity ?? 0),
      productUrl: undefined,
      imageUrl: undefined,
    }));

    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
    const totalPrice =
      data.totals?.itemPriceAfterPromos?.amount != null
        ? `${data.totals.itemPriceAfterPromos.amount} ${data.totals.itemPriceAfterPromos.currency ?? 'SEK'}`
        : undefined;

    return { items, totalItems, totalPrice };
  }


  async close(): Promise<void> {
    this.session = undefined;
  }

  // --- internal helpers ----------------------------------------------------

  private async applyQuantity(
    productId: string,
    quantity: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const body = [{ productId, quantity }];
      console.error(`apply-quantity request body: ${JSON.stringify(body)}`);
      const res = await this.fetch('/api/cart/v1/carts/active/apply-quantity', {
        method: 'POST',
        body,
      });
      await res.json(); // consume response

      return { success: true, message: `Product ${productId} quantity adjusted by ${quantity}.` };
    } catch (error) {
      return {
        success: false,
        message: `Failed to set quantity for ${productId}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async refreshCredentials(session: IcaSessionState): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);

      if (session.cookies.length > 0) {
        await context.addCookies(session.cookies);
      }

      const page = await context.newPage();
      const csrfPromise = captureCsrfToken(page);

      await page.goto(`${BASE}/stores/${session.storeId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const csrfToken = await csrfPromise;
      const cookies = await context.cookies(BASE);

      session.cookies = cookies;
      session.cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      session.csrfToken = csrfToken || session.csrfToken;

      await page.close();
      await context.close();

      console.error(`ICA credentials refreshed. CSRF: ${session.csrfToken ? 'yes' : 'none'}`);
    } finally {
      await browser.close();
    }
  }

  private fetch(urlPath: string, options: FetchOptions = {}): Promise<Response> {
    const session = this.requireSession();
    return icaFetch(session, urlPath, options, (s) => this.refreshCredentials(s));
  }
}

