# DotX web

React browser application served with the Worker. API, Query and Mutation modules are centralized by resource; page-specific components stay beside file routes. All operational guides live in the repository docs directory.

## Local development

Start Vite first:

```sh
pnpm --filter @dotx/web dev
```

Vite listens on localhost and selects an available port, starting at 5173. In a second terminal, start the local Worker with `PUBLIC_ORIGIN` set to Vite's printed URL, without its trailing slash. For example:

```sh
pnpm --filter @dotx/server dev --local --port 8787 --var PUBLIC_ORIGIN:http://localhost:5173
```

Open the Vite URL. If its port changes, restart Wrangler with that origin. Vite proxies API, OAuth, MCP and device WebSocket requests to 127.0.0.1:8787, preserving Host and Origin. The initial authorization request goes to Worker; Vite renders the approval page once it has a transaction. Login, passkeys and OAuth use the same localhost origin.

This override applies only to the local dev process. To validate the built pages through Worker directly, build Server and start Wrangler without the override; use its configured origin, `http://localhost:8787`.

## Build

`pnpm --filter @dotx/web build` emits dist and generates the route tree. The Server build copies this output and its public branding into one static asset directory. No separately deployed frontend exists.
