# DotX Desktop

Open this extracted Release attachment in local Codex, preferably with computer use enabled. For the first Mac and service, follow `plugins/dotx-desktop/skills/setup/SKILL.md`; to add this Mac to an existing service, follow `plugins/dotx-desktop/skills/join/SKILL.md`.

- **Desktop:** install from this attachment's local marketplace on each Mac. Keep the extracted files in a persistent directory.
- **Remote:** register your service's `/mcp` URL as a custom MCP connection in ChatGPT, using OAuth. This is a separate identity from Desktop.
- **Server:** download the independent Server attachment from the same Release and deploy it to your Cloudflare account using official Wrangler. It runs one Worker, OAuth KV and a single DeviceHub DO.

Adding another Mac is optional. Run join in local Codex on that Mac; it can discover the service through an authorized Remote connection on the same account, or use the existing service address. An administrator approves the new device. No second deployment, duplicate Remote connection, Cloudflare login on the new Mac or pre-existing remote control between Macs is needed.

For local updates, use `plugins/dotx-desktop/skills/update/SKILL.md`. ChatGPT/dot coordinates updates through DotX Remote's `get_instructions(goal="update")`. Read the target Release's notes for version-specific requirements and `release.json` for component changes. Desktop and Server share a release version, but unchanged components may remain installed. Worker deployment updates Remote execution code; changes to ChatGPT's cached tool catalog require a separate Refresh. Installation state and credentials live outside this package; activation may briefly disconnect DotX before it reconnects.
