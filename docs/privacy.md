# Privacy

This page describes how `${VITE_APP_NAME}` (deployed at `${VITE_APP_DOMAIN}`) handles your data.

## Architecture summary

This is a static web app. There is no server the operator runs that receives your credentials, your saves, or any other content. The page, its scripts, and its styles are static files hosted on GitHub Pages. All processing happens in your browser.

## What stays local

- Your handle and app password (only in browser memory unless you opt in to encrypted persistence).
- Your inventory of saved posts (in IndexedDB on this device).
- Any hydrated content (article text, images, thread descendants).

## What leaves your browser

- **Your Bluesky PDS** receives your authentication and AT Protocol requests when you sign in and run a fetch. This is unavoidable — it is how Bluesky works.
- **`cdn.bsky.app`** receives image fetches if you turn on image hydration.
- **Article hosts** receive fetches for any URLs in your saves if you turn on article hydration. Article hydration runs through either a local helper you install, or a Cloudflare Worker proxy you deploy. Either way, the operator never sees the traffic.
<!--
- **The operator's Bluesky account `@${VITE_OPERATOR_HANDLE}`** sees a like on a single pinned beacon post if and only if you click the "Tell @${VITE_OPERATOR_HANDLE} you used this" button. This is an ordinary Bluesky like — public on your account, identical to liking any other post. No data accompanies the like.
-->

There is no analytics service. No telemetry. No error reporting endpoint.

## GitHub Pages edge logging

Static files are hosted on GitHub Pages. GitHub sees server-level request metadata (IP, path, user agent) like any web host, per <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer">GitHub's privacy statement</a>. The operator does not have access to those logs.

## Threats out of scope

- A compromised browser extension can read anything this page can read.
- A compromised device is out of scope.
- Supply chain attacks on the GitHub Pages deploy. Mitigated by version-pinned dependencies and tag-driven CI.

## How to revoke a Bluesky app password

If you ever want to revoke the app password you used here, sign in to <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">Bluesky</a>, open <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener noreferrer">Settings → Privacy and Security → App Passwords</a>, and delete it. The app password used by this tool is unrelated to your main account password.

## Questions

Send a message to <a href="https://bsky.app/profile/${VITE_OPERATOR_HANDLE}" target="_blank" rel="noopener noreferrer">@${VITE_OPERATOR_HANDLE}</a> on Bluesky or open an issue at the project repository linked from the footer.
