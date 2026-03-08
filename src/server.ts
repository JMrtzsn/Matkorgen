import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Ica } from './stores/ica/ica';

import type { GroceryStore } from './stores/types';

// ---------------------------------------------------------------------------
// Registry — map of chain name → constructor.  Add new adapters here.
// ---------------------------------------------------------------------------

export type StoreRegistry = Record<string, () => GroceryStore>;

export const defaultRegistry: StoreRegistry = {
  ica: () => new Ica(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textContent(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

export function createServer(registry: StoreRegistry = defaultRegistry) {
  let store: GroceryStore | undefined;

  function requireStore(): GroceryStore {
    if (!store) {
      throw new Error('No store session. Call set_store first.');
    }
    return store;
  }

  async function initStore(chain: string, storeId?: string): Promise<GroceryStore> {
    const key = chain.toLowerCase();
    const ctor = registry[key];
    if (!ctor) {
      const supported = Object.keys(registry).join(', ');
      throw new Error(`Unknown store chain: "${chain}". Supported: ${supported}`);
    }

    if (store) {
      await store.close();
      store = undefined;
    }

    store = ctor();
    if (store.setStore) {
      if (!storeId) {
        throw new Error(`Store chain "${chain}" requires a storeId.`);
      }
      await store.setStore(storeId);
    }
    return store;
  }

  const server = new McpServer({
    name: 'matkorgen',
    version: '1.0.0',
  });

  server.registerTool(
    'set_store',
    {
      description:
        'Initialise a grocery store session. Provide the store chain (e.g. "ica") and optionally a store location ID (required for ICA). Must be called first.',
      inputSchema: {
        chain: z.string().min(1, 'Store chain cannot be empty (e.g. "ica").'),
        storeId: z.string().min(1, 'Store ID cannot be empty.').optional(),
      },
    },
    async ({ chain, storeId }) => {
      const s = await initStore(chain, storeId);
      const label = storeId ? ` (${storeId})` : '';
      console.error(`Store set: ${s.name}${label}`);
      return textContent(`Store set to ${s.name}${label}. Session is anonymous — call login before cart operations.`);
    },
  );

  server.registerTool(
    'login',
    {
      description:
        'Authenticate with the active store. Must be called after set_store and before cart operations.',
      inputSchema: {
        username: z.string().min(1, 'Username cannot be empty.'),
        password: z.string().min(1, 'Password cannot be empty.'),
      },
    },
    async ({ username, password }) => {
      try {
        const s = requireStore();
        await s.login(username, password);
        return textContent(`Login successful. Store: ${s.name}.`);
      } catch (error) {
        return textContent(`Login failed: ${errorMessage(error)}`, true);
      }
    },
  );

  server.registerTool(
    'search_products',
    {
      description:
        'Search for products by name or ingredient. Returns IDs, names, prices, and URLs. Requires set_store.',
      inputSchema: {
        query: z.string().min(1, 'Search query cannot be empty.'),
      },
    },
    async ({ query }) => {
      try {
        const products = await requireStore().searchProducts(query);
        if (products.length === 0) {
          return textContent(`No products found for: "${query}"`, true);
        }
        return textContent(JSON.stringify(products, null, 2));
      } catch (error) {
        return textContent(errorMessage(error), true);
      }
    },
  );

  server.registerTool(
    'add_to_cart',
    {
      description:
        'Add a product to the shopping cart by product ID and quantity. Requires set_store (and login for persistent carts).',
      inputSchema: {
        productId: z.string().min(1, 'Product ID cannot be empty.'),
        quantity: z.number().int().min(1, 'Quantity must be at least 1.'),
      },
    },
    async ({ productId, quantity }) => {
      try {
        const result = await requireStore().addToCart(productId, quantity);
        return textContent(result.message, !result.success);
      } catch (error) {
        return textContent(errorMessage(error), true);
      }
    },
  );

  server.registerTool(
    'get_cart',
    {
      description:
        'Retrieve current cart contents — items, quantities, prices, totals. Requires set_store.',
    },
    async () => {
      try {
        const cart = await requireStore().getCart();
        return textContent(JSON.stringify(cart, null, 2));
      } catch (error) {
        return textContent(errorMessage(error), true);
      }
    },
  );

  server.registerTool(
    'remove_from_cart',
    {
      description:
        'Remove a given quantity of a product from the cart. If quantity ≥ current amount the item is removed entirely. Requires set_store.',
      inputSchema: {
        productId: z.string().min(1, 'Product ID cannot be empty.'),
        quantity: z.number().int().min(1, 'Quantity must be at least 1.'),
      },
    },
    async ({ productId, quantity }) => {
      try {
        const result = await requireStore().removeFromCart(productId, quantity);
        return textContent(result.message, !result.success);
      } catch (error) {
        return textContent(errorMessage(error), true);
      }
    },
  );

  async function shutdown(): Promise<void> {
    if (store) {
      console.error('Shutting down — closing store session…');
      await store.close().catch((err) =>
        console.error('Error closing store:', errorMessage(err)),
      );
      store = undefined;
    }
  }

  return { server, shutdown, initStore };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const { server, shutdown, initStore } = createServer(defaultRegistry);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Matkorgen MCP server running on stdio');

  const autoChain = process.env.STORE_CHAIN ?? 'ica';
  const autoStoreId = process.env.ICA_STORE_ID;
  const autoUser = process.env.ICA_USERNAME;
  const autoPass = process.env.ICA_PASSWORD;

  if (autoStoreId) {
    try {
      console.error(`Auto-init: ${autoChain} / ${autoStoreId}`);
      const s = await initStore(autoChain, autoStoreId);

      if (autoUser && autoPass) {
        console.error(`Auto-authenticating: ${autoUser}`);
        await s.login(autoUser, autoPass);
        console.error('Auto-authentication successful.');
      }
    } catch (err) {
      console.error(`Auto-init failed: ${errorMessage(err)}`);
    }
  }

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
}

main().catch((error) => {
  console.error('Fatal error starting MCP server:', error);
  process.exit(1);
});
