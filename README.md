# Matkorgen — Grocery Shopping MCP Server

An MCP (Model Context Protocol) server that lets an LLM search for products,
manage a shopping cart, and interact with Swedish grocery stores. Currently
supports **ICA** via Playwright browser automation.

## Prerequisites

- **Node.js** ≥ 18
- **npm**

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/matkorgen.git
cd matkorgen

# 2. Install dependencies
npm install
npx playwright install chromium

# 3. (Optional) Add ICA credentials for cart operations
echo "ICA_USERNAME=your-ica-username" > .env
echo "ICA_PASSWORD=your-ica-password" >> .env

# 4. Build
npm run build
```

> **Anonymous mode:** If you skip step 3, the server still works for
> browsing and searching products — cart operations require authentication
> via the `login` tool at runtime.

## Usage

### As an MCP server (stdio)

```bash
npm start
# or
node dist/server.js
```

The server communicates over stdin/stdout using the MCP JSON-RPC protocol.
Configure your MCP client to spawn it as a subprocess.

### MCP client configuration

A `.mcp.json` is included in the project root for IDEs that support it (
JetBrains, VS Code, Cursor):

```json
{
    "servers": {
        "ica-shopping": {
            "type": "stdio",
            "command": "node",
            "args": [
                "dist/server.js"
            ],
            "env": {}
        }
    }
}
```

You can also set a default store via environment variable:

```json
{
    "servers": {
        "ica-shopping": {
            "type": "stdio",
            "command": "node",
            "args": [
                "dist/server.js"
            ],
            "env": {
                "ICA_STORE_ID": "1003577"
            }
        }
    }
}
```

### Testing with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

This opens a web UI where you can call tools interactively.

## Gemini Extension

This project is also a **Gemini Extension** — Gemini Pro users can install it
directly without setting up a local MCP client.

### Install from GitHub

```bash
gemini extensions install https://github.com/<your-username>/matkorgen
```

### Install from a local clone

```bash
cd matkorgen
npm install
npx playwright install chromium
npm run build
gemini extensions link .
```

### Verify

Launch the Gemini CLI and confirm the extension is registered:

```bash
gemini
> /mcp list
# Should show "ica-shopping" with its tools
```

### Configuration

On first use Gemini will prompt you for the settings declared in
`gemini-extension.json`:

| Setting        | Env Var        | Description                                                       |
|----------------|----------------|-------------------------------------------------------------------|
| `ICA_STORE_ID` | `ICA_STORE_ID` | Default store ID (optional — can also use `set_store` at runtime) |
| `ICA_USERNAME` | `ICA_USERNAME` | ICA account email (required for cart operations)                  |
| `ICA_PASSWORD` | `ICA_PASSWORD` | ICA account password (sensitive, required for cart operations)    |

### Usage

Once installed, just ask Gemini naturally:

> *"Search for milk at ICA store 1003577 and add 2 to my cart"*

Gemini will call `set_store`, `login`, `search_products`, and `add_to_cart`
automatically.

## Tools

| Tool              | Description                                        | Inputs                                           |
|-------------------|----------------------------------------------------|--------------------------------------------------|
| `set_store`       | Initialise a grocery store session.                | `chain` (string, e.g. "ica"), `storeId` (string) |
| `login`           | Authenticate with the active store.                | `username` (string), `password` (string)         |
| `search_products` | Search for products by name or ingredient.         | `query` (string)                                 |
| `add_to_cart`     | Add a product to the cart.                         | `productId` (string), `quantity` (int)           |
| `get_cart`        | Retrieve current cart contents.                    | —                                                |
| `edit_cart`       | Set product quantity in the cart. Use 0 to remove. | `productId` (string), `quantity` (int ≥ 0)       |

### Example flow (what an LLM does)

1. **`set_store("ica", "1003577")`** — target a specific ICA store
2. **`login("user@example.com", "password")`** — authenticate
3. **`search_products("mjölk")`** — find milk products
4. **`add_to_cart("2000697", 2)`** — add 2× Mjölk 3% Laktosfri
5. **`get_cart()`** — verify cart contents
6. **`edit_cart("2000697", 1)`** — reduce to 1
7. **`edit_cart("2000697", 0)`** — remove from cart

## Tests

```bash
# Build & run unit tests
npm test

# Build & run end-to-end tests (requires ICA_USERNAME / ICA_PASSWORD in .env)
npm run test:e2e
```

## Project Structure

```
src/
  server.ts                  — MCP server entry point (stdio transport, tool registration)
  stores/
    types.ts                 — Shared domain types & GroceryStore adapter interface
    ica/
      ica.ts                 — ICA adapter (session, HTTP API, Playwright auth)
      login-flow.ts          — Shared Playwright login helpers (used by ica.ts)
tests/
  e2e/
    e2e.test.ts              — End-to-end MCP server test (Client + StdioClientTransport)
specs/                       — Feature specifications
.mcp.json                    — MCP server registration for IDEs
gemini-extension.json        — Gemini Extension manifest
.auth/                       — Session state (gitignored)
```
