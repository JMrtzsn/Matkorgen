import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Ica } from './stores/ica/ica';

import type { GroceryStore } from './stores/types';

// ---------------------------------------------------------------------------
// State — the active store adapter
// ---------------------------------------------------------------------------

let store: GroceryStore | undefined;

function requireStore(): GroceryStore {
  if (!store) {
    throw new Error('No store session. Call set_store first.');
  }
  return store;
}

/**
 * Resolve a GroceryStore implementation by name.
 * Add new adapters here as they are built.
 */
function createStore(storeName: string): GroceryStore {
  switch (storeName.toLowerCase()) {
    case 'ica':
      return new Ica();
    default:
      throw new Error(`Unknown store chain: "${storeName}". Supported: ica`);
  }
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'matkorgen',
  version: '1.0.0',
});

// --- set_store ---
server.registerTool(
  'set_store',
  {
    description:
      'Initialise a grocery store session. Provide the store chain (e.g. "ica") and a store location ID. Must be called first.',
    inputSchema: {
      chain: z.string().min(1, 'Store chain cannot be empty (e.g. "ica").'),
      storeId: z.string().min(1, 'Store ID cannot be empty.'),
    },
  },
  async ({ chain, storeId }) => {
    if (store) {
      await store.close();
      store = undefined;
    }

    store = createStore(chain);
    await store.setStore(storeId);
    console.error(`Store set: ${store.name} / ${storeId}`);

    return {
      content: [{
        type: 'text' as const,
        text: `Store set to ${store.name} (${storeId}). Session is anonymous — call login before cart operations.`,
      }],
    };
  },
);

// --- login ---
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
      return {
        content: [{ type: 'text' as const, text: `Login successful. Store: ${s.name}.` }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Login failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
);

// --- search_products ---
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
        return {
          content: [{ type: 'text' as const, text: `No products found for: "${query}"` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(products, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
);

// --- add_to_cart ---
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
      return {
        content: [{ type: 'text' as const, text: result.message }],
        isError: !result.success,
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
);

// --- get_cart ---
server.registerTool(
  'get_cart',
  {
    description:
      'Retrieve current cart contents — items, quantities, prices, totals. Requires set_store.',
  },
  async () => {
    try {
      const cart = await requireStore().getCart();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(cart, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
);

// --- edit_cart ---
server.registerTool(
  'edit_cart',
  {
    description:
      'Set a product quantity in the cart. Use 0 to remove. Requires set_store.',
    inputSchema: {
      productId: z.string().min(1, 'Product ID cannot be empty.'),
      quantity: z.number().int().min(0, 'Quantity must be 0 or greater. Use 0 to remove.'),
    },
  },
  async ({ productId, quantity }) => {
    try {
      const result = await requireStore().editCart(productId, quantity);
      return {
        content: [{ type: 'text' as const, text: result.message }],
        isError: !result.success,
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
);

// --- get_session_url ---
server.registerTool(
  'get_session_url',
  {
    description:
      'Get store/cart URLs and exportable session cookies. Requires set_store.',
  },
  async () => {
    try {
      const result = await requireStore().getSessionUrls();

      const lines = [
        `Store URL: ${result.storeUrl}`,
        `Cart URL:  ${result.cartUrl}`,
        `Authenticated: ${result.authenticated}`,
        '',
        'To use in your browser:',
        '1. Install a cookie-manager extension (e.g. EditThisCookie)',
        '2. Navigate to the store URL above',
        '3. Delete existing cookies for the site',
        '4. Import the cookies JSON below',
        '5. Refresh the page',
        '',
        JSON.stringify(result.cookies, null, 2),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Matkorgen MCP server running on stdio');

  // Auto-initialise from environment variables
  const autoChain = process.env.STORE_CHAIN ?? 'ica';
  const autoStore = process.env.ICA_STORE_ID;
  const autoUser = process.env.ICA_USERNAME;
  const autoPass = process.env.ICA_PASSWORD;

  if (autoStore) {
    try {
      console.error(`Auto-init: ${autoChain} / ${autoStore}`);
      store = createStore(autoChain);
      await store.setStore(autoStore);

      if (autoUser && autoPass) {
        console.error(`Auto-authenticating: ${autoUser}`);
        await store.login(autoUser, autoPass);
        console.error('Auto-authentication successful.');
      }
    } catch (err) {
      console.error(`Auto-init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch((error) => {
  console.error('Fatal error starting MCP server:', error);
  process.exit(1);
});

