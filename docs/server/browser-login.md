# Sign in to browser management

Use when the user wants to manage DotX at `/admin`. Need: the Server URL. Browser login is independent of installing Codex or connecting a Personal Agent.

## Sign in and return

1. Open the Server's `/admin` page. Recommend **Sign in with Cloudflare** first. The user signs in and authorizes on Cloudflare's own page; DotX returns automatically and verifies direct management permission for this Server's Cloudflare account and Worker.
2. On success, continue the requested management action. A login opened from a device or Personal Agent approval keeps that original request. Signing in never approves it automatically: inspect and explicitly approve the same request.
3. Report browser access as verified only when the user or an observed browser enters management. Give `/admin` as the bookmark.

No user-created OAuth client or runtime verification variable is needed. An accepted account membership alone is insufficient; group-only permission is not supported. For a failed login or management request, use [browser login recovery](../troubleshooting/browser-login.md), then return to the original action.

## Identify the Cloudflare login

If the user is unsure which login to use, the first login page offers **Ask your installation Agent** with a copyable request. Read `account_id` from the Server's deployment configuration and [find a Wrangler login](wrangler-login.md#find-an-existing-login) that includes that account. Complete the [target-specific access check](../common/access.md), then report that login's email and return to browser sign-in. `whoami` identifies the current login, not the historical deployer. If deployment records are missing, use [configuration recovery](configuration.md#recover-deployment-configuration-on-another-machine) to identify the target first.

The first login page offers **Cloudflare login and privacy** as a short optional explanation. The full policy is at <https://oauth.dotx.run/privacy>. The public relay handles redirects and temporary codes; each Server exchanges and stores its own tokens. Do not request the user's Cloudflare password, tokens, browser cookies or passkey data.

## Use or set up a password or passkey

Password and Passkey are additional login methods. Configured methods appear directly under **Other sign-in methods**. If the user prefers them, use an existing method or help set one up; setting local credentials is not a prerequisite for Cloudflare login or approval.

| Requested action | Next step |
| --- | --- |
| Already signed in; add or change a method | Open `/admin/security` |
| Initial local setup; Agent has verified [Wrangler management access](../common/access.md) | From the service directory, run `node /ABSOLUTE/RELEASE/admin.mjs --url HTTPS_ORIGIN setup` |
| Local credentials are lost or unusable | Follow [local-credential recovery](../troubleshooting/browser-login.md#recover-local-credentials) |
| User asks another installation Agent for setup | On the first login page choose **Set up a sign-in method** and copy the prompt, including its versioned guide link |
| Login or management fails | Choose the matching [recovery branch](../troubleshooting/browser-login.md) |
| Setup response interrupted | Read `setup-status` and confirm the user's result before issuing another link |

Give the returned private link to the intended administrator: “Open this link on any device, choose a password or passkey, and enter it only on your DotX page.” The Agent does not receive the user's password or operate a passkey prompt.

Links last 24 hours; issuing another replaces the unfinished link. `setup` leaves existing local methods alone. Verify a saved local method with `setup-status`, then return to the original task. Its `configured` field describes local credentials; `initialized` records prior browser-management use, including Cloudflare login. `configured=false` alone is not a failed installation.

## Later login behavior

`/admin/security` can add or remove passwords and passkeys, including the last local method. Cloudflare login remains available. Removing local methods does not return the Server to the first-login screen. Renaming a passkey only changes its label. Passkeys are hostname-bound; changing hostname requires a new passkey. Passwords must be nonempty, without trimming, truncation or composition rules. For login limits, see [login recovery](../troubleshooting/browser-login.md#choose-by-the-actual-failure).

Browser sessions stay signed in for 30 days after management activity, without a fixed total lifetime. Cloudflare login renews automatically and continues to require this Worker's management permission. Temporary provider failures and revoked authorization have different [recovery paths](../troubleshooting/browser-login.md). Local password/passkey sessions remain independent of Cloudflare membership and grant the same management access.

Signing out immediately ends the current browser session, even when Cloudflare is unavailable. Changing local credentials signs out other browsers while keeping the current browser signed in. Revoking the public DotX application in Cloudflare can affect more than one Server using that client.
