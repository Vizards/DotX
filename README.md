<p align="center">
  <img src=".github/assets/dotx.png" width="128" height="128" alt="DotX">
</p>

<h1 align="center">DotX</h1>

<p align="center">
  <a href="https://github.com/Vizards/DotX/releases/latest">
    <img src="https://img.shields.io/github/v/release/Vizards/DotX?sort=date&amp;label=Desktop" alt="Latest stable Desktop release">
  </a>
  <a href="https://github.com/Vizards/DotX/releases/latest">
    <img src="https://img.shields.io/github/v/release/Vizards/DotX?sort=date&amp;label=Server" alt="Latest stable Server release">
  </a>
</p>

DotX connects your Personal Agent to native Codex on your Macs. Start new tasks, continue existing conversations, handle approval requests, and bring results back to your conversation.

![DotX workflow: resume a Codex task on your Mac and relay questions back to the same Personal Agent conversation.](.github/assets/how-it-works.png)

## Get started

Give an Agent your goal and this repository link:

```text
Help me install DotX: https://github.com/Vizards/DotX. Start at docs/index.md for the selected release.
```

[Agent guides](docs/index.md) cover Server installation, local Codex connection and each Personal Agent. Start wherever you need; the Agent checks what is ready, completes the work it can and hands off any steps requiring another environment or your login. A new network normally connects Server → first Codex → Personal Agent. Codex Desktop is recommended for local setup; computer use is optional.

To add another Mac, give local Codex the existing Server URL and ask it to follow [Codex connection](docs/codex/connect.md). An administrator approves that device through the Server's Cloudflare-authenticated management page or management CLI.

0.1.0 is a fresh installation from 0.0.1. Native Codex accounts, projects and conversations are preserved. Use the chosen GitHub Release's notes and guides; this branch may describe unreleased behavior.

## What you can do

Personal Agents connect to the same MCP/OAuth interface using separate authorizations. [dot](docs/personal-agents/dot/index.md) and [Cue](docs/personal-agents/cue/index.md) have client-specific setup and update guides. Other clients can use the standard flow; compatibility must be checked in that client. [Report compatibility issues](https://github.com/Vizards/DotX/issues).

### Start tasks and continue conversations

Your Personal Agent can create a new Codex conversation directly or send follow-up work to an existing one. Codex uses the projects, files, and tools on that Mac.

![Scripted demo: start a Codex task on a MacBook to investigate a bug, then continue the same conversation to fix it and add a regression test.](.github/assets/start-and-continue.webp)

### Work across your Macs

Your Personal Agent can coordinate Codex tasks on several Macs at once and bring their progress and results into one conversation.

![Scripted demo: coordinate API and frontend reviews on two Macs and check their progress in one chat.](.github/assets/work-across-macs.webp)

### Answer Codex from the same chat

When Codex needs a decision, your Personal Agent can bring the question or approval request back to you and pass your answer along. Ask to be notified when the task finishes, or check its progress whenever you need to.

![Scripted demo: answer a Codex question, approve dependency installation, and receive the result in the same chat.](.github/assets/questions-and-results.webp)

### Let your Personal Agent handle updates

Your Personal Agent can spot new releases as you use DotX and let you know when an update is available. When you're ready, you can ask it to coordinate updates across your Macs and the Cloudflare service.

## Help

See [Troubleshooting](docs/troubleshooting/index.md) for known issues, or [report a problem](https://github.com/Vizards/DotX/issues).

## License

[MIT](LICENSE)
