# Set up or recover browser management

Use when the user wants to manage DotX at `/admin` without Wrangler. This is optional for installing Codex or Personal Agents. Need: the Server URL and, for initial setup/reset, an Agent with verified [Wrangler management access](../common/access.md).

## Choose the action

| Current state | Action |
| --- | --- |
| Login already configured and available | Open `/admin` and sign in with the user's password or passkey |
| First setup requested | Run `node admin.mjs --url HTTPS_ORIGIN setup` |
| User explicitly needs recovery of lost login | Run `node admin.mjs --url HTTPS_ORIGIN reset-login` |
| Setup response interrupted | Read `setup-status` and confirm whether the user entered the management page before issuing another link |
| User defers setup | Record it as deferred and return to the installation/management task using Wrangler |

Give the returned private link to the intended administrator: “Open this link on any device, choose a password or passkey, and enter it only on your DotX page.” No CF OAuth client, browser automation or credential transfer to the Agent is needed.

Links last 24 hours; issuing another replaces the unfinished link. `setup` leaves already configured login methods alone. A reset leaves existing login working until the user completes it; completion replaces all old login methods and ends their sessions. It does not reset devices, PA connections or storage.

## Verify and return

Read `setup-status` to confirm a login method is saved. Report browser access as verified only when the user or an observed browser actually enters `/admin`. Give that fixed URL as the bookmark, not the private setup link. Return to the task that requested setup, or [close the installation](../common/handoff.md#close-the-requested-installation).

## Later login behavior

`/admin/security` adds/removes login methods while keeping at least one. A password and one or more passkeys share the same management authority. Passkeys are hostname-bound; changing hostname needs a new passkey. Passwords must be nonempty; there is no length/composition policy or trimming/truncation. Password attempts and passkey login starts share ten attempts per minute; retry immediately while attempts remain, otherwise wait for the displayed window.

Each authenticated management request extends the session and cookie by 30 days. There is no fixed total lifetime or background keepalive. Expired/revoked sessions require login. Signing out ends that browser's session. Changing login methods signs out other browsers and rotates the current session. CF membership changes do not revoke this independent browser access; change/reset these methods to revoke it. Credentials and sessions persist in DeviceHub.
