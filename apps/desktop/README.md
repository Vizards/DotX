# DotX Desktop package

This package connects a Mac's or Windows PC's Codex to an existing DotX Server. It includes the local plugin, one navigation Skill and the complete version-matched Agent guides. On Windows the plugin's `mcp.json` must be the PowerShell variant (`mcp.windows.json`, which launches through `launch.ps1`) instead of the `sh` one; the `client_coordination` interface is currently unavailable there because the Windows desktop app does not expose the coordination socket (see the Windows section of the connect guide).

Start at [the bundled guide index](plugins/dotx-desktop/docs/index.md). For installation use [Connect this Mac's Codex](plugins/dotx-desktop/docs/codex/connect.md); for updates use [Update Codex](plugins/dotx-desktop/docs/codex/update.md).

Install the local marketplace at `.agents/plugins/marketplace.json` through Codex's normal plugin mechanism. Keep the extracted package in a persistent location. The plugin uses the host-provided `PLUGIN_DATA` directory for its identity and configuration; the package and plugin cache contain no credentials. `device_status` reports the resolved storage and actual connector owner.

Server deployment uses the independent Server attachment. Each Personal Agent follows its own guide. Computer use is optional where the host exposes the required operations through tools.

Read `release.json` and the target GitHub Release notes before updating. A component update and the network becoming usable are separate checks. A 0.0.1 installation requires a fresh 0.1.0 connection; native Codex data is preserved.
