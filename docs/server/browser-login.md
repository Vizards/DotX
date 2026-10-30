# Set up or recover browser management

Use when the user wants to manage DotX at `/admin` without Wrangler. This is optional for installing Codex or Personal Agents. Need: the Server URL. Initial setup or recovery needs either the user's Cloudflare permission to edit the Worker, or an Agent with verified [Wrangler management access](../common/access.md).

## Choose the action

| Current state | Action |
| --- | --- |
| Login already configured and available | Open `/admin` and sign in with the user's password or passkey |
| First setup requested; Wrangler management is available | Run `node admin.mjs --url HTTPS_ORIGIN setup` |
| User explicitly needs recovery; Wrangler management is available | Run `node admin.mjs --url HTTPS_ORIGIN reset-login` |
| User wants to set up or recover independently | Open `/admin` and follow the Cloudflare verification below |
| Setup response interrupted | Read `setup-status` and confirm whether the user entered the management page before issuing another link |
| User defers setup | Record it as deferred and return to the installation/management task using Wrangler |

Give the returned private link to the intended administrator: “Open this link on any device, choose a password or passkey, and enter it only on your DotX page.” No CF OAuth client, browser automation or credential transfer to the Agent is needed.

Links last 24 hours; issuing another replaces the unfinished link. `setup` leaves already configured login methods alone. A reset leaves existing login working until the user completes it; completion replaces all old login methods and ends their sessions. It does not reset devices, PA connections or storage.

## Self-service with Cloudflare

At `/admin`, choose **Verify with Cloudflare** for first setup, or **Having trouble? → Start verification** for recovery. Opening the setup page does not start verification. **Verify with Cloudflare** resumes an existing unfinished setup; its label stays the same and there is no second start action. The page provides a verification value and a link to the exact Worker's Cloudflare settings. Set the runtime variable `DOTX_ADMIN_CLAIM` to that value and deploy, then return to DotX to choose a password or passkey. Both Variable and Secret work; use Variable for a new entry and keep an existing entry's type. **Copy and open Cloudflare** copies `NAME=value` for a new entry; paste it into Cloudflare's **Key** field to fill both fields. For an existing entry, it copies only the value for its **Value** field. Follow the page's add/edit instructions; do not send the user's password, cookies or CF credentials to an Agent.

The request lasts 24 hours from creation. Returning to `/admin` in the same browser offers to continue it; the verification dialog checks the current deployment and also provides **Check now**. Closing the page, a deployment delay, or cancelling Passkey creation does not require a new request. Verification ignores surrounding whitespace in the Cloudflare value, including spaces and line breaks; characters inside the value must match exactly. If the value does not match, keep the current request and check the Worker, variable name/value and deployment. The page identifies a missing value or a `NAME=` prefix pasted into Value without displaying the deployed value. Losing the browser cookie or reaching expiry requires a new request and variable write. **Verify again** explicitly replaces this browser's unfinished request after confirmation.

Verification approves only setting this browser's login method. A saved password/passkey completes the request and ends other unfinished setup requests and old browser sessions. Before that, old login methods still work. There is no need to delete the Secret afterwards; its old value cannot revive completed requests. The next request uses a different value. When setup or recovery started from a device/PA approval link, completion returns to that request. Browser setup alone does not approve it.

The Server allows ten new or restarted self-service requests per 60-second window, shared across browsers. Continuing or verifying an existing request does not use this budget. If creation is temporarily limited, wait for the displayed retry time; restarting is not a workaround. Existing requests and normal password/passkey login use separate paths and remain available.

## Verify and return

Read `setup-status` to confirm a login method is saved. Report browser access as verified only when the user or an observed browser actually enters `/admin`. Give that fixed URL as the bookmark, not the private setup link. Return to the task that requested setup, or [close the installation](../common/handoff.md#close-the-requested-installation).

## Later login behavior

`/admin/security` adds/removes login methods while keeping at least one. A password and one or more passkeys share the same management authority. Renaming a passkey changes only its displayed label; it does not change authentication or end sessions. Passkeys are hostname-bound; changing hostname needs a new passkey. Passwords must be nonempty; there is no length/composition policy or trimming/truncation. Password attempts and passkey login starts share ten attempts per minute; retry immediately while attempts remain, otherwise wait for the displayed window.

Authenticated management activity keeps a sliding 30-day session, with renewal saved at most once per hour. The cookie follows that saved expiry; there is no fixed total lifetime or background keepalive. Expired/revoked sessions require login. Signing out ends that browser's session. Changing login methods signs out other browsers and rotates the current session. CF membership changes do not revoke this independent browser access; change/reset these methods to revoke it. Credentials and sessions persist in DeviceHub.
