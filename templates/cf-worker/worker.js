// Cloudflare Worker — CORS proxy for bsky-saves-gui article hydration.
// Deploy instructions: see README.md in this directory.
// Environment variables (set via `wrangler secret put`):
//   ALLOWED_ORIGIN  — the Origin header value allowed to call this worker
//                     (e.g. "https://saves.lightseed.net")
//   SHARED_SECRET   — arbitrary secret; callers must send it as X-Proxy-Secret

export default {
  /** @param {Request} request @param {Env} env */
  async fetch(request, env) {
    return new Response('Not implemented', { status: 501 });
  },
};
