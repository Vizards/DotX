# Contributor guidance

## Development

- Use the Node.js requirement and pnpm version declared in `package.json`, with the root lockfile.
- Install dependencies with `pnpm install --frozen-lockfile`.
- Run checks appropriate to the change: `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test` and `pnpm build`. Use package filters for focused checks.
- Verify Worker deployment changes with `pnpm --filter @dotx/server build:worker` (dry-run).
- Keep experiments under ignored `dev/`; production code, tests and release artifacts must not depend on it.
- For installation, update or runtime issues, start with [the troubleshooting guide](docs/troubleshooting/index.md) and follow relevant links.

## Architecture

- `apps/desktop/` owns the local MCP, native Codex adapters and setup primitives.
- `apps/server/` owns Cloudflare hosting, authorization, enrollment, persistent state and notifications. DotX Remote's six tools live in `src/mcp/` within this package.
- `packages/shared/` owns cross-component contracts. Desktop and Server depend on Shared; Shared must not depend on either application.
- Keep native adapters under `interfaces/`, single-call execution under `gateway/`, and exact-turn observation under `tracking/`.
- Desktop and Remote have separate installation identities. Desktop and Server ship as separate Release attachments; Desktop contains no Worker or Wrangler deployment materials.

## Behavioral contracts

- Business persistence belongs in the single DeviceHub DO. Desktop retains only installation configuration, caller identity, credentials and diagnostics on disk; business observations and native handles remain in memory.
- Ordinary RPCs return native responses directly. Do not persist their parameters/results or turn them into background tasks.
- Tracked sends correlate durable request records with exact native turns. Acceptance is not completion; caller, target thread, host and device identities are distinct.
- Reconnection restores observation, never commands. Native operations and DO writes cannot commit atomically; reconcile unknown outcomes instead of resending.
- Native interaction handles cannot be restored from cloud storage. Recover current native state after losing process-local events.
- App Tools and desktop coordination use private interfaces. Annotate those dependencies, probe actual capabilities and preserve actionable diagnostics. Do not gate working interfaces on desktop release labels.
- Preserve normal desktop plugin loading. Do not modify application files, signatures, CLI/backend binaries or startup behavior.
- Keep credentials and real conversation content out of source and release artifacts. Live tests require authorization for their targets and operations; use synthetic conversations where possible.

## Installation and releases

- GPT orchestrates installation and updates through the skills in `apps/desktop/skills/`. Setup commands return results and necessary links without opening browsers or choosing UI sessions.
- Use official Wrangler and declarative deployment configuration. Do not introduce a deployment orchestrator or installation state machine.
- User installation and update flows do not run project tests or dispatch synthetic tasks. Avoid assumptions about a particular machine, browser, account or installation path.
- GitHub Actions owns release assembly. Maintain one product release version and a separate wire protocol version; product version differences alone do not imply protocol incompatibility.
- Review the three release change flags against their declared stable baseline. Runtime update discovery only compares versions; the update skill determines required operations after the user chooses to update.
- Updating Server changes Remote execution code. Changed tool definitions or instructions also require ChatGPT's normal catalog Refresh.
