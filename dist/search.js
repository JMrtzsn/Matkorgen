"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchIcaProduct = searchIcaProduct;
const zod_1 = require("zod");
const api_client_1 = require("./api-client");
// Define the input schema for the search tool
const SearchProductInputSchema = zod_1.z.object({
    ingredient: zod_1.z.string().min(1, 'Ingredient cannot be empty.'),
});
// Define the schema for a single product
const ProductSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    price: zod_1.z.string().optional(), // Price might not always be present or easily extractable
    unit: zod_1.z.string().optional(), // e.g., "1.5L", "kg"
    imageUrl: zod_1.z.string().optional(),
    productUrl: zod_1.z.string().optional(), // Full URL to the product page
});
// Define the output schema for the search tool
const SearchProductOutputSchema = zod_1.z.object({
    products: zod_1.z.array(ProductSchema),
    errorMessage: zod_1.z.string().optional(), // Descriptive error message if something goes wrong
});
async function searchIcaProduct(input, session) {
    try {
        const { ingredient } = SearchProductInputSchema.parse(input);
        const storeId = session.storeId;
        console.error(`Searching for: ${ingredient} (store: ${storeId}) via API`);
        const params = new URLSearchParams({
            includeAdditionalPageInfo: 'false',
            maxPageSize: '10',
            maxProductsToDecorate: '10',
            q: ingredient,
            tag: 'web',
        });
        const searchPath = `/api/webproductpagews/v6/product-pages/search?${params}`;
        const res = await (0, api_client_1.icaFetch)(session, searchPath);
        const data = await res.json();
        console.error('Search API response keys:', Object.keys(data));
        // Products are nested under productGroups[].decoratedProducts[]
        const productGroups = data.productGroups ?? [];
        const rawProducts = productGroups.flatMap((g) => g.decoratedProducts ?? []);
        const products = rawProducts.map((raw) => {
            const productId = String(raw.productId ?? '');
            const retailerId = String(raw.retailerProductId ?? '');
            const priceAmount = raw.promoPrice?.amount ?? raw.price?.amount;
            return {
                id: productId,
                name: String(raw.name ?? 'Unknown'),
                price: priceAmount != null ? `${priceAmount} ${raw.price?.currency ?? 'SEK'}` : undefined,
                unit: raw.packSizeDescription ?? undefined,
                imageUrl: raw.image?.src ?? undefined,
                productUrl: retailerId
                    ? `https://handlaprivatkund.ica.se/stores/${storeId}/products/${retailerId}`
                    : undefined,
            };
        });
        if (products.length > 0) {
            console.error(`Found ${products.length} products for: ${ingredient}`);
            return { products };
        }
        return { products: [], errorMessage: `No products found for: "${ingredient}"` };
    }
    catch (error) {
        console.error(`Error in searchIcaProduct: ${error}`);
        if (error instanceof zod_1.z.ZodError) {
            return { products: [], errorMessage: `Invalid input: ${error.issues.map(i => i.message).join(', ')}` };
        }
        return { products: [], errorMessage: `Search failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
