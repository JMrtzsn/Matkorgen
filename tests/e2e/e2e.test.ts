// tests/e2e/e2e.test.ts
// End-to-end MCP server test — acts as an LLM client over stdio.
// Spawns dist/server.js, connects via the MCP client SDK, and exercises:
//   set_store → login → search_products → add_to_cart → get_cart → edit_cart
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const ICA_USERNAME = process.env.ICA_USERNAME;
const ICA_PASSWORD = process.env.ICA_PASSWORD;

describe('MCP server e2e', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: 'node',
      args: [path.resolve(__dirname, '..', '..', 'dist', 'server.js')],
      stderr: 'pipe',
    });

    transport.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[server] ${chunk.toString()}`);
    });

    client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    await client.close();
  }, 15000);

  it('lists all six tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['add_to_cart', 'edit_cart', 'get_cart', 'login', 'search_products', 'set_store']);
  }, 10000);

  it('requires set_store before search', async () => {
    const result = await client.callTool({
      name: 'search_products',
      arguments: { query: 'mjölk' },
    });
    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toContain('set_store');
  }, 10000);

  it('set_store → search → add → get → edit → verify → cleanup', async () => {
    // 0. Set store
    console.error('--- Step 0: set_store ---');
    const storeResult = await client.callTool({
      name: 'set_store',
      arguments: { chain: 'ica', storeId: '1003577' },
    });
    expect(storeResult.isError).toBeFalsy();
    const storeText = (storeResult.content as any)[0].text as string;
    expect(storeText).toContain('1003577');
    console.error(`Store result: ${storeText}`);

    // 0.5. Login
    console.error('--- Step 0.5: login ---');
    if (!ICA_USERNAME || !ICA_PASSWORD) {
      throw new Error('ICA_USERNAME and ICA_PASSWORD must be set in .env');
    }
    const loginResult = await client.callTool({
      name: 'login',
      arguments: { username: ICA_USERNAME, password: ICA_PASSWORD },
    }, undefined, { timeout: 120_000 });
    expect(loginResult.isError).toBeFalsy();
    const loginText = (loginResult.content as any)[0].text as string;
    expect(loginText).toContain('successful');
    console.error(`Login result: ${loginText}`);

    // 1. Search for a product
    console.error('--- Step 1: search_products ---');
    const searchResult = await client.callTool({
      name: 'search_products',
      arguments: { query: 'mjölk' },
    });
    expect(searchResult.isError).toBeFalsy();

    const products = JSON.parse((searchResult.content as any)[0].text);
    expect(products.length).toBeGreaterThan(0);

    const product = products[0];
    expect(product.id).toBeTruthy();
    console.error(`Found: ${product.name} (ID: ${product.id})`);

    // 1.5. Pre-cleanup — remove the product if it's already in the cart
    console.error('--- Step 1.5: pre-cleanup ---');
    const cleanupResult = await client.callTool({
      name: 'edit_cart',
      arguments: { productId: product.id, quantity: 0 },
    });
    console.error(`Cleanup result: ${(cleanupResult.content as any)[0].text}`);

    // 2. Add product to cart
    console.error('--- Step 2: add_to_cart ---');
    const addResult = await client.callTool({
      name: 'add_to_cart',
      arguments: {
        productId: product.id,
        quantity: 1,
      },
    });
    const addText = (addResult.content as any)[0].text as string;
    console.error(`Add result (isError=${addResult.isError}): ${addText}`);
    expect(addResult.isError).toBeFalsy();
    expect(addText).toContain(product.id);

    // 3. Verify product is in cart
    console.error('--- Step 3: get_cart ---');
    const getResult = await client.callTool({
      name: 'get_cart',
      arguments: {},
    });
    expect(getResult.isError).toBeFalsy();

    const cart = JSON.parse((getResult.content as any)[0].text);
    expect(cart.totalItems).toBeGreaterThan(0);

    const cartItem = cart.items.find((i: any) => i.productId === product.id);
    expect(cartItem).toBeDefined();
    expect(cartItem.quantity).toBeGreaterThanOrEqual(1);
    console.error(`Cart item: ${cartItem.name}, qty: ${cartItem.quantity}`);

    // 4. Edit quantity (increment by 1)
    const newQty = cartItem.quantity + 1;
    console.error(`--- Step 4: edit_cart → qty ${newQty} ---`);
    const editResult = await client.callTool({
      name: 'edit_cart',
      arguments: { productId: product.id, quantity: newQty },
    });
    expect(editResult.isError).toBeFalsy();
    console.error(`Edit result: ${(editResult.content as any)[0].text}`);

    // 5. Verify updated quantity
    console.error('--- Step 5: get_cart (verify) ---');
    const verifyResult = await client.callTool({
      name: 'get_cart',
      arguments: {},
    });
    expect(verifyResult.isError).toBeFalsy();

    const updatedCart = JSON.parse((verifyResult.content as any)[0].text);
    const updatedItem = updatedCart.items.find((i: any) => i.productId === product.id);
    expect(updatedItem).toBeDefined();
    expect(updatedItem.quantity).toBe(newQty);
    console.error(`Verified: ${updatedItem.name}, qty: ${updatedItem.quantity}`);

    // 6. Clean up — remove from cart
    console.error('--- Step 6: edit_cart → remove ---');
    const removeResult = await client.callTool({
      name: 'edit_cart',
      arguments: { productId: product.id, quantity: 0 },
    });
    expect(removeResult.isError).toBeFalsy();
    expect((removeResult.content as any)[0].text).toContain('removed');
    console.error('E2E flow complete.');
  }, 300000);
});

