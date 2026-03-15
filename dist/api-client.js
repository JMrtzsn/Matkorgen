"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.icaFetch = icaFetch;
const crypto_1 = require("crypto");
const session_1 = require("./session");
const BASE = 'https://handlaprivatkund.ica.se';
/**
 * Thin wrapper around Node `fetch` that injects ICA session cookies,
 * CSRF token, and required headers.
 *
 * `path` is relative to `/stores/{storeId}`, e.g. `/api/cart/v1/carts/active`.
 */
async function icaFetch(session, path, options = {}) {
    const url = `${BASE}/stores/${session.storeId}${path}`;
    const method = options.method ?? 'GET';
    console.error(`icaFetch ${method} ${url}`);
    const headers = {
        accept: 'application/json; charset=utf-8',
        'content-type': 'application/json; charset=utf-8',
        cookie: session.cookieString,
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        origin: BASE,
        referer: `${BASE}/stores/${session.storeId}`,
        'ecom-request-source': 'web',
        'ecom-request-source-version': '2.0.0',
        'client-route-id': (0, crypto_1.randomUUID)(),
        'page-view-id': (0, crypto_1.randomUUID)(),
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        ...(session.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}),
        ...options.headers,
    };
    const res = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    // On 401/403, try refreshing credentials once and retry
    if (res.status === 401 || res.status === 403) {
        console.error(`Got ${res.status} — refreshing credentials and retrying...`);
        await (0, session_1.refreshCredentials)(session);
        headers.cookie = session.cookieString;
        if (session.csrfToken) {
            headers['x-csrf-token'] = session.csrfToken;
        }
        const retry = await fetch(url, {
            method,
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
        });
        if (!retry.ok) {
            const text = await retry.text().catch(() => '');
            throw new Error(`ICA API ${method} ${path} failed after retry: ${retry.status} ${text}`);
        }
        return retry;
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`ICA API ${method} ${path} failed: ${res.status} ${text}`);
    }
    // Guard against empty or non-JSON responses (e.g. WAF challenge pages)
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
        const body = await res.text().catch(() => '');
        console.error(`ICA API ${method} ${path} returned non-JSON (${res.status}, ${contentType}): ${body.slice(0, 200)}`);
        throw new Error(`ICA API ${method} ${path} returned non-JSON response (${contentType}). Likely missing auth or WAF challenge.`);
    }
    return res;
}
