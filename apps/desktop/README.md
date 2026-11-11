# DotX Desktop package

This single package connects Codex on macOS or native Windows to an existing DotX Server. It includes the local plugin, one navigation Skill and the complete version-matched Agent guides.

Start at [the bundled guide index](../../docs/index.md). For installation use [Connect this computer's Codex](../../docs/codex/connect.md); for updates use [Update Codex](../../docs/codex/update.md).

Install the local marketplace at `.agents/plugins/marketplace.json` through Codex's normal plugin mechanism. Keep the extracted package in a persistent location. The plugin uses the host-provided `PLUGIN_DATA` directory for its identity and configuration; the package and plugin cache contain no credentials. `device_status` reports the resolved storage and actual connector owner.

Use the [local runtime and command reference](../../docs/codex/runtime.md) for the platform launcher and host context. Windows uses the host-provided Node/CLI and system Windows PowerShell; diagnose failures through the bundled guides.

Server deployment uses the independent Server attachment. Each Personal Agent follows its own guide. Computer use is optional where the host exposes the required operations through tools.

Read `release.json` and the target GitHub Release notes before updating. A component update and the network becoming usable are separate checks. Use [update coordination](../../docs/maintenance/update.md) for compatibility and upgrade boundaries.
