"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIcaCart = getIcaCart;
const zod_1 = require("zod");
const api_client_1 = require("./api-client");
// Define the schema for a single cart item
const CartItemSchema = zod_1.z.object({
    productId: zod_1.z.string(),
    name: zod_1.z.string(),
    price: zod_1.z.string().optional(),
    quantity: zod_1.z.number().int(),
    productUrl: zod_1.z.string().optional(),
    imageUrl: zod_1.z.string().optional(),
});
// Define the output schema for the get_cart tool
const GetCartOutputSchema = zod_1.z.object({
    items: zod_1.z.array(CartItemSchema),
    totalItems: zod_1.z.number().int(),
    totalPrice: zod_1.z.string().optional(),
    errorMessage: zod_1.z.string().optional(),
});
async function getIcaCart(session) {
    try {
        console.error('Fetching cart contents via API...');
        const res = await (0, api_client_1.icaFetch)(session, '/api/cart/v1/carts/active');
        const data = await res.json();
        const rawItems = data.items ?? [];
        // Cart API returns UUIDs (productId) with prices/quantities but no names.
        // We expose the productId so callers can cross-reference with search results.
        const items = rawItems.map((raw) => ({
            productId: String(raw.productId ?? ''),
            name: String(raw.productId ?? 'Unknown'), // API has no name — use productId as placeholder
            price: raw.finalPrice?.amount != null
                ? `${raw.finalPrice.amount} ${raw.finalPrice.currency ?? 'SEK'}`
                : undefined,
            quantity: Number(raw.quantity ?? 0),
            productUrl: undefined,
            imageUrl: undefined,
        }));
        const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
        const totalPrice = data.totals?.itemPriceAfterPromos?.amount != null
            ? `${data.totals.itemPriceAfterPromos.amount} ${data.totals.itemPriceAfterPromos.currency ?? 'SEK'}`
            : undefined;
        console.error(`Cart contains ${items.length} unique products (${totalItems} total items). Total: ${totalPrice}`);
        return { items, totalItems, totalPrice };
    }
    catch (error) {
        console.error(`Error in getIcaCart: ${error}`);
        return {
            items: [],
            totalItems: 0,
            errorMessage: `Failed to fetch cart: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
