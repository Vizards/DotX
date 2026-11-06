# Coordinate an update

## Identify the current and target versions

Use the evidence available in the current environment:

| Available capability | Read |
| --- | --- |
| Connected Personal Agent MCP | `list_connections` for Server/device versions and the cached release hint |
| Local Codex plugin | `device_status` for the actual owner's version, target and interfaces |
| Server URL and management tools | `/health` for Server version; after the [access check](../common/access.md), `admin.mjs devices` for registered device state |

A maintenance Agent with Wrangler access does not need a Personal Agent connection to update Server. A missing/unavailable update hint is not proof that a component is current or broken. Read the selected target GitHub Release notes, component change flags and attachments before changing anything. Reuse the user's stated scope; resolve only missing choices that affect which components or machines will change.

## Apply the selected release

- changes.server: follow [Server update](../server/update.md). It includes web pages and bundled Server guides.
- changes.desktop: follow [Codex update](../codex/update.md) locally on each affected Mac. It includes the plugin's bundled guides.
- changes.remote_catalog: [refresh each Personal Agent's tools](../personal-agents/index.md#refresh-tools).

Follow the target release's required operation order. Product versions alone do not imply incompatibility; wire must match. It is acceptable for a link to be temporarily unavailable while updating components. Report component completion and link restoration separately, and do not automatically resend unknown in-flight calls after reconnection.

An Agent without deployment or local Mac capability should perform available checks, then hand off the exact target artifact, guide, identities, completed work and remaining steps. A native task may continue after the remote connection drops; inspect its current state before further action.

No project test suite or synthetic task belongs in a user's ordinary update. Use read-only discovery/native checks. Finish with [handoff](../common/handoff.md).

## Release discovery

The Server queries GitHub's public Releases API anonymously when list_connections needs a fresh update hint. RELEASE_CHANNEL defaults to `stable`, which uses GitHub's latest full release. Every other channel matches the first SemVer prerelease identifier: `0.0.3-dev.12` belongs to `dev`, `0.0.3-rc.2` to `rc`, and `0.0.3-beta.1` to `beta`.

For a prerelease channel, discovery examines the first 100 GitHub Releases and selects the highest SemVer among published prereleases in that channel. Drafts, invalid versions and other channels are ignored. It does not search older pages or switch channels automatically. No matching release means the update hint is unknown, not that the installation is current.

Results are cached per repository and channel for six hours; failed lookups reuse their diagnostic for five minutes and preserve the last successful result. Anonymous GitHub API quotas apply to the outgoing IP address, so a Worker may receive a rate-limit response even with infrequent DotX queries. An unavailable hint does not prevent Codex operations. Review GitHub Release notes directly when choosing a version without a current hint.
