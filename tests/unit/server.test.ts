/**
 * Unit tests for the Matkorgen MCP server.
 *
 * Uses an in-memory transport and a MockStore so tests are fast,
 * deterministic, and require no network or Playwright.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server';
import { MockStore } from './mock-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the text string from the first content block of a tool result. */
function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result.content as any)[0].text as string;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MCP server (unit)', () => {
  let client: Client;
  let mockStore: MockStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    mockStore = new MockStore();

    const { server, shutdown } = createServer({
      mock: () => mockStore,
    });

    // Wire up client ↔ server via in-memory transport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    client = new Client({ name: 'unit-test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    cleanup = async () => {
      await shutdown();
      await client.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  // -----------------------------------------------------------------------
  // Tool listing
  // -----------------------------------------------------------------------

  it('lists all six tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_to_cart',
      'get_cart',
      'login',
      'remove_from_cart',
      'search_products',
      'set_store',
    ]);
  });

  // -----------------------------------------------------------------------
  // set_store
  // -----------------------------------------------------------------------

  describe('set_store', () => {
    it('initialises a store session', async () => {
      const result = await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '42' },
      });

      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('MockStore');
      expect(text(result)).toContain('(42)');
      expect(mockStore.storeId).toBe('42');
    });

    it('initialises a store session without storeId when chain does not need it', async () => {
      // Create a minimal store that does NOT implement setStore
      const noStoreIdMock = new MockStore();
      const storeWithoutSetStore = {
        get name() { return noStoreIdMock.name; },
        login: noStoreIdMock.login.bind(noStoreIdMock),
        searchProducts: noStoreIdMock.searchProducts.bind(noStoreIdMock),
        addToCart: noStoreIdMock.addToCart.bind(noStoreIdMock),
        removeFromCart: noStoreIdMock.removeFromCart.bind(noStoreIdMock),
        getCart: noStoreIdMock.getCart.bind(noStoreIdMock),
        close: noStoreIdMock.close.bind(noStoreIdMock),
        // Note: no setStore
      };

      const { server: server2, shutdown: shutdown2 } = createServer({
        simple: () => storeWithoutSetStore,
      });

      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server2.connect(st);
      const client2 = new Client({ name: 'test2', version: '1.0.0' });
      await client2.connect(ct);

      const result = await client2.callTool({
        name: 'set_store',
        arguments: { chain: 'simple' },
      });

      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('MockStore');

      await shutdown2();
      await client2.close();
    });

    it('returns error when chain requires storeId but none provided', async () => {
      // MockStore has setStore, so it requires storeId
      const result = await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock' },
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('requires a storeId');
    });

    it('returns error for unknown chain', async () => {
      const result = await client.callTool({
        name: 'set_store',
        arguments: { chain: 'nonexistent', storeId: '1' },
      });

      expect(result.isError).toBe(true);
    });

    it('closes previous store when called again', async () => {
      // First set_store — the mock registry always returns the same mockStore
      // instance, so we grab a reference before the second call.
      await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '1' },
      });

      const firstStore = mockStore;
      expect(firstStore.closeCalled).toBe(false);

      // Second set_store on the same server — should close the first store.
      await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '2' },
      });

      // The first mock should have been closed
      expect(firstStore.closeCalled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Requires set_store
  // -----------------------------------------------------------------------

  describe('before set_store', () => {
    const toolsRequiringStore = [
      { name: 'login', arguments: { username: 'u', password: 'p' } },
      { name: 'search_products', arguments: { query: 'milk' } },
      { name: 'add_to_cart', arguments: { productId: '1', quantity: 1 } },
      { name: 'remove_from_cart', arguments: { productId: '1', quantity: 1 } },
      { name: 'get_cart', arguments: {} },
    ];

    for (const tool of toolsRequiringStore) {
      it(`${tool.name} returns error when no store is set`, async () => {
        const result = await client.callTool(tool);
        expect(result.isError).toBe(true);
        expect(text(result).toLowerCase()).toContain('set_store');
      });
    }
  });

  // -----------------------------------------------------------------------
  // login
  // -----------------------------------------------------------------------

  describe('login', () => {
    beforeEach(async () => {
      await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '42' },
      });
    });

    it('succeeds with valid credentials', async () => {
      const result = await client.callTool({
        name: 'login',
        arguments: { username: 'alice', password: 'secret' },
      });

      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('successful');
      expect(mockStore.loggedInUser).toBe('alice');
    });

    it('returns error when store login throws', async () => {
      mockStore.loginError = 'Invalid credentials';

      const result = await client.callTool({
        name: 'login',
        arguments: { username: 'bad', password: 'bad' },
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Invalid credentials');
    });
  });

  // -----------------------------------------------------------------------
  // search_products
  // -----------------------------------------------------------------------

  describe('search_products', () => {
    beforeEach(async () => {
      await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '42' },
      });
    });

    it('returns matching products', async () => {
      const result = await client.callTool({
        name: 'search_products',
        arguments: { query: 'Mjölk' },
      });

      expect(result.isError).toBeFalsy();
      const products = JSON.parse(text(result));
      expect(products).toHaveLength(1);
      expect(products[0].id).toBe('1001');
      expect(products[0].name).toBe('Mjölk 3% 1L');
    });

    it('returns isError when no products found', async () => {
      const result = await client.callTool({
        name: 'search_products',
        arguments: { query: 'nonexistent-product-xyz' },
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('No products found');
    });

    it('returns multiple products for broad query', async () => {
      // Use a query that matches multiple mock products
      const result = await client.callTool({
        name: 'search_products',
        arguments: { query: 'k' },  // Mjölk, Ägg (no), Bröd (no) — just Mjölk
      });

      expect(result.isError).toBeFalsy();
    });
  });

  // -----------------------------------------------------------------------
  // add_to_cart
  // -----------------------------------------------------------------------

  describe('add_to_cart', () => {
    beforeEach(async () => {
      await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '42' },
      });
    });

    it('adds a product to the cart', async () => {
      const result = await client.callTool({
        name: 'add_to_cart',
        arguments: { productId: '1001', quantity: 2 },
      });

      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('1001');

      // Verify via get_cart
      const cartResult = await client.callTool({ name: 'get_cart', arguments: {} });
      const cart = JSON.parse(text(cartResult));
      expect(cart.totalItems).toBe(2);
      expect(cart.items[0].productId).toBe('1001');
    });

    it('returns isError when addToCart fails', async () => {
      mockStore.addToCartError = 'Out of stock';

      const result = await client.callTool({
        name: 'add_to_cart',
        arguments: { productId: '1001', quantity: 1 },
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Out of stock');
    });
  });

  // -----------------------------------------------------------------------
  // get_cart
  // -----------------------------------------------------------------------

  describe('get_cart', () => {
    beforeEach(async () => {
      await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '42' },
      });
    });

    it('returns empty cart initially', async () => {
      const result = await client.callTool({ name: 'get_cart', arguments: {} });

      expect(result.isError).toBeFalsy();
      const cart = JSON.parse(text(result));
      expect(cart.items).toEqual([]);
      expect(cart.totalItems).toBe(0);
    });

    it('returns cart with items after add', async () => {
      await client.callTool({
        name: 'add_to_cart',
        arguments: { productId: '1001', quantity: 1 },
      });
      await client.callTool({
        name: 'add_to_cart',
        arguments: { productId: '1002', quantity: 3 },
      });

      const result = await client.callTool({ name: 'get_cart', arguments: {} });
      const cart = JSON.parse(text(result));

      expect(cart.items).toHaveLength(2);
      expect(cart.totalItems).toBe(4); // 1 + 3
    });
  });

  // -----------------------------------------------------------------------
  // remove_from_cart
  // -----------------------------------------------------------------------

  describe('remove_from_cart', () => {
    beforeEach(async () => {
      await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '42' },
      });
      // Pre-populate cart
      await client.callTool({
        name: 'add_to_cart',
        arguments: { productId: '1001', quantity: 3 },
      });
    });

    it('reduces product quantity', async () => {
      const result = await client.callTool({
        name: 'remove_from_cart',
        arguments: { productId: '1001', quantity: 1 },
      });

      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('reduced');

      const cartResult = await client.callTool({ name: 'get_cart', arguments: {} });
      const cart = JSON.parse(text(cartResult));
      expect(cart.items[0].quantity).toBe(2);
    });

    it('removes product entirely when quantity ≥ current amount', async () => {
      const result = await client.callTool({
        name: 'remove_from_cart',
        arguments: { productId: '1001', quantity: 3 },
      });

      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('removed');

      const cartResult = await client.callTool({ name: 'get_cart', arguments: {} });
      const cart = JSON.parse(text(cartResult));
      expect(cart.items).toHaveLength(0);
    });

    it('returns isError when removeFromCart fails', async () => {
      mockStore.removeFromCartError = 'Cart locked';

      const result = await client.callTool({
        name: 'remove_from_cart',
        arguments: { productId: '1001', quantity: 1 },
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Cart locked');
    });
  });

  // -----------------------------------------------------------------------
  // Full shopping flow
  // -----------------------------------------------------------------------

  describe('full shopping flow', () => {
    it('set_store → login → search → add → get → edit → remove', async () => {
      // 1. Set store
      const storeResult = await client.callTool({
        name: 'set_store',
        arguments: { chain: 'mock', storeId: '99' },
      });
      expect(storeResult.isError).toBeFalsy();

      // 2. Login
      const loginResult = await client.callTool({
        name: 'login',
        arguments: { username: 'test@example.com', password: 'pass123' },
      });
      expect(loginResult.isError).toBeFalsy();
      expect(text(loginResult)).toContain('successful');

      // 3. Search
      const searchResult = await client.callTool({
        name: 'search_products',
        arguments: { query: 'Ägg' },
      });
      expect(searchResult.isError).toBeFalsy();
      const products = JSON.parse(text(searchResult));
      expect(products.length).toBeGreaterThan(0);
      const eggId = products[0].id;

      // 4. Add to cart
      const addResult = await client.callTool({
        name: 'add_to_cart',
        arguments: { productId: eggId, quantity: 2 },
      });
      expect(addResult.isError).toBeFalsy();

      // 5. Verify cart
      const cartResult = await client.callTool({ name: 'get_cart', arguments: {} });
      const cart = JSON.parse(text(cartResult));
      expect(cart.totalItems).toBe(2);
      expect(cart.items[0].productId).toBe(eggId);

      // 6. Edit quantity
      const editResult = await client.callTool({
        name: 'add_to_cart',
        arguments: { productId: eggId, quantity: 3 },
      });
      expect(editResult.isError).toBeFalsy();

      // 7. Remove
      const removeResult = await client.callTool({
        name: 'remove_from_cart',
        arguments: { productId: eggId, quantity: 5 },
      });
      expect(removeResult.isError).toBeFalsy();
      expect(text(removeResult)).toContain('removed');

      // 8. Verify empty cart
      const emptyResult = await client.callTool({ name: 'get_cart', arguments: {} });
      const emptyCart = JSON.parse(text(emptyResult));
      expect(emptyCart.totalItems).toBe(0);
      expect(emptyCart.items).toHaveLength(0);
    });
  });
});

