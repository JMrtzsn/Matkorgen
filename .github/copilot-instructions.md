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

## Adding a Store Adapter

1. Implement `GroceryStore` from `src/stores/types.ts`.
2. Register in `defaultRegistry` in `src/server.ts`.
3. Add unit + E2E tests.

## Style Guide

Follow the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
as the baseline, with the project-specific refinements below.

### TypeScript

- **Strict mode always.** Never weaken `tsconfig.json` strict flags.
- **No `any`.** Use `unknown` and narrow with type guards. If truly unavoidable,
  suppress with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
  and add a comment explaining why.
- **`import type` for type-only imports.** Enforces erasable imports and keeps
  runtime bundles clean.
- **`interface` over `type` for public API shapes.** Use `type` for unions,
  intersections, and mapped types only.
- **`readonly` by default.** Mark properties, parameters, and arrays as
  `readonly` unless mutation is required.
- **Prefer `const` assertions and enums sparingly.** Use `as const` for literal
  unions. Avoid numeric enums; use string enums or plain union types.
- **Return explicit types on exported functions.** Inferred types are fine for
  internal/private helpers.
- **Use `satisfies` for type-safe object literals** when you want both
  inference and constraint checking.

### Naming

| Symbol            | Convention                          | Example                   |
|:------------------|:------------------------------------|:--------------------------|
| Files & folders   | `kebab-case`                        | `login-flow.ts`           |
| Interfaces/Types  | `PascalCase`, no `I` prefix         | `GroceryStore`            |
| Classes           | `PascalCase`                        | `Ica`                     |
| Functions/methods | `camelCase`                         | `searchProducts`          |
| Constants         | `camelCase` or `UPPER_SNAKE_CASE`   | `defaultRegistry`, `MAX_RETRIES` |
| Enum members      | `PascalCase`                        | `StoreChain.Ica`          |
| Type parameters   | Single uppercase or descriptive     | `T`, `TResult`            |

### Error Handling

- Throw typed `Error` subclasses or plain `Error` with descriptive messages.
- Catch `unknown`, never `any`. Narrow before accessing properties.
- Use the `errorMessage()` helper already in `server.ts` for safe stringification.
- Fail fast: validate inputs at the boundary (tool handlers), not deep in
  adapters.

### Functions & Control Flow

- Keep functions short (< 40 lines as a guideline). Extract when logic is
  independently testable.
- Prefer early returns over deeply nested `if`/`else`.
- Avoid `default` exports. Use named exports exclusively.
- No side-effectful top-level code outside of the entry-point (`server.ts`).

### Async & Concurrency

- Always `await` promises. Never fire-and-forget unless intentional and
  documented.
- Prefer `Promise.all` / `Promise.allSettled` for independent concurrent work.
- Avoid `new Promise()` constructor when an `async` function suffices.
- Ensure resources (Playwright browsers, pages) are cleaned up in `finally`
  blocks or equivalent teardown.

### Testing (Vitest)

- **File placement:** Unit tests in `tests/unit/`, E2E tests in `tests/e2e/`.
- **Naming:** `*.test.ts` for unit, `*.e2e.ts` for end-to-end.
- **Structure:** Use `describe` blocks grouped by function/feature. Use `it`
  (not `test`) for individual cases.
- **Assertions:** Prefer `expect(x).toBe()` / `toEqual()` / `toThrow()`. Avoid
  loose truthy checks.
- **Mocks:** Keep mocks minimal. Prefer dependency injection (the
  `StoreRegistry` pattern) over module-level mocking.
- **No test logic:** Tests must not contain conditionals or loops. One
  assertion path per `it` block.

### Playwright (Browser Automation)

- Use strict selectors (`getByRole`, `getByText`, `getByTestId`) over fragile
  CSS/XPath.
- Set explicit timeouts on `waitFor` / `waitForSelector` calls; never rely on
  global defaults.
- Each adapter owns its browser lifecycle. Create in `setStore`/`login`, close
  in `close()`.

### Comments & Documentation

- **JSDoc** on all exported interfaces, types, and functions. Keep descriptions
  to one sentence unless the behaviour is non-obvious.
- Inline comments only for *why*, never *what*. If the code needs a *what*
  comment, refactor for clarity.
- No commented-out code in committed files.

### Dependencies

- Standard library first (`node:fs`, `node:path`, `node:crypto`, etc.).
- Current project deps: `@modelcontextprotocol/sdk`, `playwright`, `zod`,
  `dotenv`. Justify any new addition.
- Pin all versions. Avoid `^` or `~` in `package.json`.

### Git & PRs

- One logical change per commit. Squash noise before merging.
- PR titles follow the same conventional commit format.

