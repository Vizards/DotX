# Contributor guidance

For installation, configuration, connection, usage, updates or troubleshooting, start with [the Agent guide index](docs/index.md) for the installed or selected release. Source development follows the rules below.

## Development

- Use the Node.js requirement and pnpm version declared in `package.json`, with the root lockfile.
- Install dependencies with `pnpm install --frozen-lockfile`.
- Run checks appropriate to the change: `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test` and `pnpm build`. Use package filters for focused checks.
- Verify Worker deployment changes with `pnpm --filter @dotx/server build:worker` (dry-run).
- Keep experiments under ignored `dev/`; production code, tests and release artifacts must not depend on it.
- For installation, update or runtime issues, start with [the troubleshooting guide](docs/troubleshooting/index.md) and follow relevant links.

## Testing

- Maintain automated integration tests for Server's public interfaces in the local Cloudflare runtime: MCP (including events), administrator APIs and browser sessions, Personal Agent OAuth, and HTTP page/asset routing. Organize them under `apps/server/test/{mcp,admin,oauth,http}/`, with shared fixtures in `support/`. Use the production Worker entry and disposable storage; do not call internal classes/functions or inspect private state. Device WebSockets may prepare fixtures and supply opaque peer responses. Substitute only external service responses (such as Cloudflare identity/token endpoints); this does not establish real provider compatibility.
- Simulated peers may speak DotX's own device wire protocol. Do not mock Codex or ChatGPT behavior, native responses, permissions, turns or events.
- Do not write internal-logic unit tests, including for Shared. Desktop and cross-end flows are verified against real installations using the maintainer's agent procedures in Notion, not procedures shipped in this repository or release packages.
- Do not duplicate those real-environment scenarios with mock tests. Select relevant procedures for a change; do not require the entire suite for every edit.
- CI checks Server public-interface behavior, types, formatting and builds; it does not establish native Codex/ChatGPT compatibility. Report real-environment results separately.

## Architecture

- `apps/web/` owns all browser pages, route-local UI and central API/query/mutation definitions; its build is deployed with Server as one Worker.
- `apps/desktop/` owns the local MCP, native Codex adapters and setup primitives.
- `apps/server/` owns Cloudflare hosting, authorization, enrollment, persistent state and notifications. DotX Remote's seven tools live in `src/mcp/` within this package.
- `packages/shared/` owns cross-component contracts. Desktop and Server depend on Shared; Shared must not depend on either application.
- Keep MCP subscription schemas, event catalogs and filtering in Server. Shared retains only event data carried between Desktop and Server.
- Keep native adapters under `interfaces/`, single-call execution under `gateway/`, and exact-turn observation under `tracking/`.
- Desktop and Remote have separate installation identities. Desktop and Server ship as separate Release attachments; Desktop contains no Worker or Wrangler deployment materials.

## Behavioral contracts

- Desktop identities use Ed25519 keys in the host-provided PLUGIN_DATA directory. One fd-locked connector owns the cloud connection; other plugin entries query its local status.
- Business persistence belongs in the single DeviceHub DO. Desktop retains only installation configuration, caller identity, credentials and diagnostics on disk; business observations and native handles remain in memory.
- Ordinary RPCs return native responses directly. Do not persist their parameters/results or turn them into background tasks.
- Calls without request_id have no durable receipt or deduplication. Supplying request_id opts into durable execution metadata; thread_turn tracking requires it. Do not classify native methods with a read/write allowlist.
- Tracked sends correlate durable request records with exact native turns. Acceptance is not completion; caller, target thread, host and device identities are distinct.
- Keep native subscriptions process-local. Do not persist follow intents or automatically reconstruct them after reconnects, restarts or patch gaps; callers use `get_request` or an explicit follow to read current state. Native operations and DO writes cannot commit atomically; reconcile unknown outcomes instead of resending.
- MCP Events persist active subscription configuration and pending failed-delivery retries, not event history or replay cursors. Normal notifications are best effort after business state commits; callers reconcile missed tracked-turn notifications with `get_request`.
- Native interaction handles cannot be restored from cloud storage. Recover current native state after losing process-local events.
- App Tools and desktop coordination use private interfaces. Annotate those dependencies, probe actual capabilities and preserve actionable diagnostics. Do not gate working interfaces on desktop release labels.
- Diagnostics are best-effort pointers for reproducing a problem. Preserve native errors and current failure context, but do not maintain RPC histories, forensic traces or diagnostic archives. Diagnostic writes must not block operations or cleanup.
- Preserve normal desktop plugin loading. Do not modify application files, signatures, CLI/backend binaries or startup behavior.
- Keep credentials and real conversation content out of source and release artifacts. Live tests require authorization for their targets and operations; use synthetic conversations where possible.

## Installation and releases

- `docs/` is the only maintained Agent guide source. Desktop bundles it with one navigation Skill; Server returns full Markdown through `get_instructions`. Setup commands return results and links without choosing browser sessions.
- Server installation, local Codex connection and Personal Agent connection are independent guides with completion checks and handoffs. First and later Macs use the same plugin. Client-specific configuration and refresh belong under `docs/personal-agents/`, not core Server/Desktop logic.
- Server owns public branding under `apps/server/public/branding/`. MCP metadata and setup reuse it; Server releases include `public/`, and deployment moves `main` and `assets.directory` together.
- Use official Wrangler and declarative deployment configuration. Do not introduce a deployment orchestrator or installation state machine.
- User installation and update flows do not run project tests or dispatch synthetic tasks. Avoid assumptions about a particular machine, browser, account or installation path.
- GitHub Actions owns release assembly. Maintain one product release version and a separate wire protocol version; product version differences alone do not imply protocol incompatibility.
- Feature branches and PRs describe the change, without a release version in their names. Use Conventional Commits; incompatible changes use `feat!:` and a `BREAKING CHANGE` explanation in the final squash commit. Release-please owns formal product version fields, its manifest and the changelog; do not pre-bump them in feature work. The current target is 0.1.0, with wire 5 (0.0.1 used wire 4).
- Before publishing a dev/RC candidate, review `.github/release-changes.json` as one unit: `base_release` and the `server`, `desktop`, `remote_catalog` flags must describe that candidate against the declared stable baseline. Commit any corrections with the selected source. Before merging a Release PR, review them again against the complete release scope, together with the upgrade requirements; repeat after the Release PR changes. Ordinary feature commits need not rewrite this file, and it is not restricted to Release PRs.
- Pre-releases can build a branch, tag or commit before any Release PR exists. Dispatch `release.yml` with `target_version` (for example `0.1.0`), source input `ref`, and optional `rc_number`. An empty RC number produces `0.1.0-dev.<run>.<attempt>`; an RC number produces `0.1.0-rc.<number>`. The workflow resolves the source to one SHA and reads its release changes; version injection happens only in the temporary build workspace and artifacts.
- When testing workflow changes before merge, select the pushed feature branch as the workflow's execution ref (`gh workflow run release.yml --ref <workflow-branch> -f ref=<source-ref> -f target_version=0.1.0`). The CLI `--ref` chooses the workflow definition; input `-f ref` chooses the source to build. The existing default-branch workflow enables manual dispatch; selecting only a source ref while executing the main workflow does not test branch-local workflow changes.
- Runtime update discovery only compares versions; the update guides determine required operations after the user chooses to update.
- For stable releases and Pre-releases, write version-specific upgrade requirements directly in GitHub Release notes and verify them before reporting the release ready. Include applicable configuration changes, operation order, migrations and catalog Refresh requirements. Keep reusable steps in the component update guides; do not maintain a separate release-notes source file or standalone skill attachment.
- Updating Server changes MCP execution code. Changed tool definitions or instructions require each Personal Agent’s normal catalog refresh as described in its guide.
