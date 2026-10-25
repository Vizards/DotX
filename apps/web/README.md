# DotX web

React browser application served with the Worker. API, Query and Mutation modules are centralized by resource; page-specific components stay beside file routes. All operational guides live in the repository docs directory.

Run `pnpm --filter @dotx/web dev` alongside `pnpm --filter @dotx/server dev`. Vite listens only on 127.0.0.1 and uses its default port selection: start at 5173 and try the next available port if occupied. Use the URL printed at startup. Control endpoints proxy to 127.0.0.1:8787. Use the Worker origin for full OAuth/CSRF and production-equivalent validation. Browser authentication callbacks must match the configured public origin.

`pnpm --filter @dotx/web build` emits dist and generates the route tree. The Server build copies this output and its public branding into one static asset directory. No separately deployed frontend exists.
