# Matkorgen — Grocery Shopping MCP Extension

This MCP server lets you assist users with grocery shopping on Swedish stores. Currently supports **ICA**. You can search for products, manage a shopping cart, view starred favourites, and browse purchase history (regulars).

## Tools

### Store Selection & Authentication

*   **`set_store`**: Initialise a grocery store session. **Must be called first.**
    *   Input: `{ "chain": "ica", "storeId": "1003577" }`

*   **`login`**: Authenticate with username and password. **Required for cart, favourites, and purchase history.**
    *   Input: `{ "username": "string", "password": "string" }`

### Product Discovery

*   **`search_products`**: Search for products by name or ingredient.
    *   Input: `{ "query": "mjölk" }`
    *   Returns: list of products with `id`, `name`, `price`, `unit`, `productUrl`.

*   **`get_favourites`**: Retrieve the user's starred/favourite products. Requires login.
    *   Input: `{}`
    *   Returns: list of products with `id`, `name`, `productUrl`.

*   **`get_purchase_history`**: Retrieve the user's frequently purchased products (regulars). Requires login.
    *   Input: `{}`
    *   Returns: list of products with `id`, `name`, `productUrl`.

### Cart Management

*   **`get_cart`**: Retrieve current cart contents, total count, and total price.
    *   Input: `{}`

*   **`add_to_cart`**: Add a product to the cart.
    *   Input: `{ "productId": "string", "quantity": number }`

*   **`remove_from_cart`**: Remove a quantity of a product from the cart.
    *   Input: `{ "productId": "string", "quantity": number }`

## Recommended Workflow

1.  Call `set_store` with the chain and store ID.
2.  Call `login` with the user's credentials.
3.  Use `get_favourites` or `get_purchase_history` to quickly find products the user regularly buys.
4.  Use `search_products` to find new products.
5.  Use `add_to_cart` / `remove_from_cart` to build the shopping list.
6.  Use `get_cart` to review and confirm.

## Important Notes

*   **Product IDs**: Always use the `id` from tool responses when calling cart tools.
*   **Swedish queries**: ICA uses Swedish product names. Search for "mjölk" not "milk", "ägg" not "eggs".
*   **Favourites/regulars return sparse products**: Only `id`, `name`, and `productUrl` — no price or image. Use `search_products` if you need full details.
*   **Session management**: If a session times out, call `set_store` and `login` again.
