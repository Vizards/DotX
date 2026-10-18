# DotX Desktop

Give this extracted Release attachment to GPT with local Mac access and ask it to install and configure DotX. The onboarding skill is `plugins/dotx-desktop/skills/setup/SKILL.md`.

- **Desktop:** install from this attachment's local marketplace on each Mac. Keep the extracted files in a persistent directory.
- **Remote:** register your service's `/mcp` URL as a custom MCP connection in ChatGPT, using OAuth. This is a separate identity from Desktop.
- **Server:** download the independent Server attachment from the same Release and deploy it to your Cloudflare account using official Wrangler. It runs one Worker, OAuth KV and a single DeviceHub DO.

On another Mac using the same account, ask GPT to join your existing DotX service. It can discover the address through an authorized Remote connection; an administrator approves the new device. No second deployment or Remote connection is needed.

For local updates, use `plugins/dotx-desktop/skills/update/SKILL.md`. ChatGPT/dot coordinates updates through DotX Remote's `get_instructions(goal="update")`. Read the target Release's notes for version-specific requirements and `release.json` for component changes. Desktop and Server share a release version, but unchanged components may remain installed. Worker deployment updates Remote execution code; changes to ChatGPT's cached tool catalog require a separate Refresh. Installation state and credentials live outside this package; activation may briefly disconnect DotX before it reconnects.
