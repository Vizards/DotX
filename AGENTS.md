# Contributor guidance

## Development

- Use the Node.js requirement and pnpm version declared in `package.json`, with the root lockfile.
- Install dependencies with `pnpm install --frozen-lockfile`.
- Run checks appropriate to the change: `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test` and `pnpm build`. Use package filters for focused checks.
- Verify Worker deployment changes with `pnpm --filter @dotx/server build:worker` (dry-run).
- Keep experiments under ignored `dev/`; production code, tests and release artifacts must not depend on it.
- For installation, update or runtime issues, start with [the troubleshooting guide](docs/troubleshooting/index.md) and follow relevant links.

## Testing

- Maintain automated tests only for DotX Server interfaces, through HTTP, MCP or the device WebSocket entry point in the local Cloudflare runtime. Use synthetic inputs and disposable storage; do not call internal classes/functions or inspect their private state.
- Simulated peers may speak DotX's own device wire protocol. Do not mock Codex or ChatGPT behavior, native responses, permissions, turns or events.
- Do not write internal-logic unit tests, including for Shared. Desktop and cross-end flows are verified against real installations using the maintainer's agent procedures in Notion, not procedures shipped in this repository or release packages.
- Do not duplicate those real-environment scenarios with mock tests. Select relevant procedures for a change; do not require the entire suite for every edit.
- CI checks Server interfaces, types, formatting and builds; it does not establish native Codex/ChatGPT compatibility. Report real-environment results separately.

## Architecture

- `apps/desktop/` owns the local MCP, native Codex adapters and setup primitives.
- `apps/server/` owns Cloudflare hosting, authorization, enrollment, persistent state and notifications. DotX Remote's seven tools live in `src/mcp/` within this package.
- `packages/shared/` owns cross-component contracts. Desktop and Server depend on Shared; Shared must not depend on either application.
- Keep native adapters under `interfaces/`, single-call execution under `gateway/`, and exact-turn observation under `tracking/`.
- Desktop and Remote have separate installation identities. Desktop and Server ship as separate Release attachments; Desktop contains no Worker or Wrangler deployment materials.

## Behavioral contracts

- Business persistence belongs in the single DeviceHub DO. Desktop retains only installation configuration, caller identity, credentials and diagnostics on disk; business observations and native handles remain in memory.
- Ordinary RPCs return native responses directly. Do not persist their parameters/results or turn them into background tasks.
- Tracked sends correlate durable request records with exact native turns. Acceptance is not completion; caller, target thread, host and device identities are distinct.
- Keep native subscriptions process-local. Do not persist follow intents or automatically reconstruct them after reconnects, restarts or patch gaps; callers use `get_request` or an explicit follow to read current state. Native operations and DO writes cannot commit atomically; reconcile unknown outcomes instead of resending.
- Native interaction handles cannot be restored from cloud storage. Recover current native state after losing process-local events.
- App Tools and desktop coordination use private interfaces. Annotate those dependencies, probe actual capabilities and preserve actionable diagnostics. Do not gate working interfaces on desktop release labels.
- Preserve normal desktop plugin loading. Do not modify application files, signatures, CLI/backend binaries or startup behavior.
- Keep credentials and real conversation content out of source and release artifacts. Live tests require authorization for their targets and operations; use synthetic conversations where possible.

## Installation and releases

- Remote's update skill lives in `apps/server/skills/update/` and is served by `get_instructions(goal="update")`; local installation and execution skills live in `apps/desktop/skills/`. Setup commands return results and necessary links without opening browsers or choosing UI sessions.
- Use official Wrangler and declarative deployment configuration. Do not introduce a deployment orchestrator or installation state machine.
- User installation and update flows do not run project tests or dispatch synthetic tasks. Avoid assumptions about a particular machine, browser, account or installation path.
- GitHub Actions owns release assembly. Maintain one product release version and a separate wire protocol version; product version differences alone do not imply protocol incompatibility.
- Review the three release change flags against their declared stable baseline. Runtime update discovery only compares versions; the update skill determines required operations after the user chooses to update.
- For stable releases and Pre-releases, write version-specific upgrade requirements directly in GitHub Release notes and verify them before reporting the release ready. Include applicable configuration changes, operation order, migrations and catalog Refresh requirements. Keep reusable steps in the two update skills; do not maintain a separate release-notes source file or standalone skill attachment.
- Updating Server changes Remote execution code. Changed tool definitions or instructions also require ChatGPT's normal catalog Refresh.
