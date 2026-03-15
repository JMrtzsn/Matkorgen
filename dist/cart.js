"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyQuantity = applyQuantity;
exports.addIcaProductToCart = addIcaProductToCart;
const zod_1 = require("zod");
const api_client_1 = require("./api-client");
// Define the input schema for the add_to_cart tool
const AddToCartInputSchema = zod_1.z.object({
    productId: zod_1.z.string().min(1, "Product ID cannot be empty."),
    quantity: zod_1.z.number().int().min(1, "Quantity must be at least 1."),
    productUrl: zod_1.z.string().url("Product URL must be a valid URL.").optional(),
});
// Define the output schema for the add_to_cart tool
const AddToCartOutputSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string(),
});
/**
 * Applies a quantity for a product in the active cart via the ICA REST API.
 * Used by both add-to-cart and edit-cart operations.
 */
async function applyQuantity(session, productId, quantity) {
    try {
        const body = [{ productId, quantity }];
        console.error(`apply-quantity request body: ${JSON.stringify(body)}`);
        const res = await (0, api_client_1.icaFetch)(session, '/api/cart/v1/carts/active/apply-quantity', {
            method: 'POST',
            body,
        });
        const data = await res.json();
        console.error(`apply-quantity response:`, JSON.stringify(data).slice(0, 500));
        if (quantity < 0) {
            return { success: true, message: `Product ${productId} removed from cart.` };
        }
        return { success: true, message: `Product ${productId} quantity set to ${quantity}.` };
    }
    catch (error) {
        console.error(`apply-quantity failed: ${error}`);
        return {
            success: false,
            message: `Failed to set quantity for product ${productId}: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
async function addIcaProductToCart(input, session) {
    try {
        const { productId, quantity } = AddToCartInputSchema.parse(input);
        console.error(`Adding product ${productId} with quantity ${quantity} via API.`);
        return await applyQuantity(session, productId, quantity);
    }
    catch (error) {
        console.error(`Error in addIcaProductToCart: ${error}`);
        if (error instanceof zod_1.z.ZodError) {
            return { success: false, message: `Invalid input for addIcaProductToCart: ${error.issues.map(issue => issue.message).join(', ')}` };
        }
        return { success: false, message: `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}` };
    }
}
