"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editIcaCart = editIcaCart;
const zod_1 = require("zod");
const cart_1 = require("./cart");
const get_cart_1 = require("./get-cart");
// Define the input schema for the edit_cart tool
const EditCartInputSchema = zod_1.z.object({
    productId: zod_1.z.string().min(1, "Product ID cannot be empty."),
    quantity: zod_1.z.number().int().min(0, "Quantity must be 0 or greater. Use 0 to remove the item."),
});
// Define the output schema for the edit_cart tool
const EditCartOutputSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string(),
});
async function editIcaCart(input, session) {
    try {
        const { productId, quantity: targetQuantity } = EditCartInputSchema.parse(input);
        console.error(`Editing cart via API: product ${productId}, target quantity: ${targetQuantity}`);
        // Fetch current cart to compute the delta
        const cart = await (0, get_cart_1.getIcaCart)(session);
        const currentItem = cart.items.find(i => i.productId === productId);
        const currentQuantity = currentItem?.quantity ?? 0;
        const delta = targetQuantity - currentQuantity;
        console.error(`Current qty: ${currentQuantity}, target: ${targetQuantity}, delta: ${delta}`);
        if (delta === 0) {
            return { success: true, message: `Product ${productId} already at quantity ${targetQuantity}.` };
        }
        return await (0, cart_1.applyQuantity)(session, productId, delta);
    }
    catch (error) {
        console.error(`Error in editIcaCart: ${error}`);
        if (error instanceof zod_1.z.ZodError) {
            return { success: false, message: `Invalid input: ${error.issues.map(i => i.message).join(', ')}` };
        }
        return { success: false, message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` };
    }
}
