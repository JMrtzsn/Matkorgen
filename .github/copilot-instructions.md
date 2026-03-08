# Matkorgen — Copilot Instructions

This is an MCP server for grocery shopping at Swedish stores (currently ICA).
Built with TypeScript, Node.js, and Playwright for browser automation.

## Quick Commands

- `npm run build` — Compile TypeScript
- `npm test` — Build + unit tests (vitest)
- `npm run test:e2e` — Build + E2E tests (needs `.env` with ICA credentials)
- `npm run lint` — ESLint
- `npm run inspector` — MCP Inspector for manual tool testing

## Architecture

- **`src/server.ts`** — MCP server entry point. Registers tools (`set_store`,
  `login`, `search_products`, `add_to_cart`, `get_cart`, `remove_from_cart`),
  handles stdio transport. Uses a `StoreRegistry` pattern for multiple chains.
- **`src/stores/types.ts`** — `GroceryStore` interface and domain types.
- **`src/stores/ica/`** — ICA adapter using Playwright browser automation.

## Conventions

- TypeScript strict mode, no `any`.
- ESLint for linting.
- Vitest for testing. Unit: `vitest.config.ts`, E2E: `vitest.config.e2e.ts`.
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`.

## Adding a Store Adapter

1. Implement `GroceryStore` from `src/stores/types.ts`.
2. Register in `defaultRegistry` in `src/server.ts`.
3. Add unit + E2E tests.

