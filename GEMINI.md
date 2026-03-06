# Matkorgen — Grocery Shopping MCP Extension for Gemini

This Model Context Protocol (MCP) server allows you to assist users with their grocery shopping on Swedish grocery stores. Currently supports **ICA**. You can search for products, manage a shopping cart (add, edit, remove items), and handle user authentication.

## Capabilities

You have access to the following tools to interact with the grocery store:

### 1. Store Selection & Authentication

*   **`set_store`**:
    *   **Description**: Initialise a grocery store session. **Must be called first.**
    *   **Input**: `{ "chain": "string", "storeId": "string" }` (e.g., `{ "chain": "ica", "storeId": "1003577" }`)
    *   **Usage**: Call this at the start of a session or if the user wants to switch stores.

*   **`login`**:
    *   **Description**: Authenticates the user with their username and password.
    *   **Input**: `{ "username": "string", "password": "string" }`
    *   **Usage**: Call this immediately after `set_store` if the user provides credentials, or whenever cart operations require authentication. **Required for persistent cart management.**

### 2. Product Discovery

*   **`search_products`**:
    *   **Description**: Searches for products by name or ingredient.
    *   **Input**: `{ "query": "string" }` (e.g., "mjölk", "bananer")
    *   **Output**: Returns a list of products with `id`, `name`, `price`, `unit`, and `productUrl`.
    *   **Usage**: Resolve ambiguity before adding to cart. Display options to the user if the search term is broad.

### 3. Cart Management

*   **`get_cart`**:
    *   **Description**: Retrieves the current contents of the shopping cart.
    *   **Input**: `{}`
    *   **Output**: Returns a list of items in the cart, total count, and total price.
    *   **Usage**: Check cart status, verify additions, or summarize the shopping list.

*   **`add_to_cart`**:
    *   **Description**: Adds a specific product to the cart.
    *   **Input**: `{ "productId": "string", "quantity": number }`
    *   **Usage**: Add items found via `search_products`.

*   **`edit_cart`**:
    *   **Description**: Modifies the quantity of an item already in the cart.
    *   **Input**: `{ "productId": "string", "quantity": number }` (set quantity to 0 to remove)
    *   **Usage**: Change quantities or remove items.

## Recommended Workflow

1.  **Initialization**:
    *   Ask the user for their preferred **Store ID** (or use a default if known) and **Credentials** (if they want to save their cart).
    *   Call `set_store(chain, storeId)`.
    *   If credentials are provided, call `login(username, password)`.

2.  **Shopping**:
    *   **User**: "I need milk and eggs."
    *   **Gemini**:
        1.  Call `search_products({ "query": "mjölk" })`.
        2.  Present options to the user or pick the best match if tailored.
        3.  Call `add_to_cart({ "productId": "...", "quantity": 1 })`.
        4.  Repeat for "eggs" (`search_products({ "query": "ägg" })`).

3.  **Review & Checkout**:
    *   **User**: "What's in my cart?"
    *   **Gemini**: Call `get_cart()`. Display the summary.

## Important Notes for Gemini

*   **Store Context**: You effectively control a headless browser. `set_store` initializes this browser. If the session times out or is lost, you may need to call `set_store` and `login` again.
*   **Product IDs**: Always use the `id` returned from `search_products` or `productId` from `get_cart` when calling `add_to_cart` or `edit_cart`.
*   **Ambiguity**: If a user asks for "cheese", search specifically for "ost" or ask for the type (e.g., "prästost", "hushållsost").
*   **Confirmation**: After adding or editing items, it is good practice to confirm the action with the user or show the updated cart total.
