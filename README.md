# BlueSky Saves Exporter

> _Working title — final product name TBD. The user-visible name is set by `VITE_APP_NAME` and can be changed without touching code._

A web GUI for [`bsky-saves`](https://github.com/tenorune/bsky-saves) that lets a Bluesky user export their saved posts as JSON, a flat Markdown file, or a self-contained HTML/CSS archive.

## What it does

- Exports your Bluesky saves as JSON, Markdown, or a navigable HTML archive.
- Runs entirely in your browser — there is no server that holds your credentials or content.
- Optional hydration of threads, articles, and images via [`bsky-saves`](https://github.com/tenorune/bsky-saves) running under [Pyodide](https://pyodide.org).

## Try it

The reference deployment lives at the domain configured for this build (see `VITE_APP_DOMAIN` in `.env.example`). The default is `saves.lightseed.net`.

## How it works

Static SPA. Pyodide loads the published `bsky-saves` Python package in your browser; AT Protocol requests go directly from your browser to your PDS. Inventory is stored locally in IndexedDB. Exports are generated and downloaded entirely client-side.

See the design spec: [`docs/superpowers/specs/2026-05-01-bsky-saves-gui-design.md`](docs/superpowers/specs/2026-05-01-bsky-saves-gui-design.md).

## Privacy

No analytics service. No telemetry. The deployer cannot see your credentials, your saves, or any post content. The only signal the deployer ever receives is an explicit "Tell @${operator} you used this" button click, which likes a single pinned beacon post on the operator's account.

Full details once Plan 7 lands: `docs/privacy.md`.

## Self-host / fork

1. Clone the repo.
2. `cp .env.example .env` and edit the `VITE_*` values for your deployment.
3. Push to GitHub. Configure GitHub Pages to deploy from GitHub Actions.
4. Set repository variables (Settings → Secrets and variables → Actions → Variables) for each `VITE_*` value the deploy workflow needs.
5. Add a DNS `CNAME` record at your domain provider pointing your chosen subdomain to `<your-username>.github.io`.

The full configuration table lives in the design spec: [Configuration section](docs/superpowers/specs/2026-05-01-bsky-saves-gui-design.md#configuration-deploy-agnostic).

## The helper

A separate Python package (`bsky-saves-gui-helper`, working name) handles article hydration. It runs locally on `127.0.0.1:7878` and lets the browser fetch arbitrary article URLs that would otherwise be blocked by CORS. To be implemented in Plan 5; see `helper/README.md` once available.

## The proxy template

A one-file Cloudflare Worker template at `templates/cf-worker/` provides the same capability without installing Python — the user deploys it to their own Cloudflare account. To be implemented in Plan 6; see `templates/cf-worker/README.md` once available.

## Development

Requires Node 20 and pnpm 9.

```bash
pnpm install
pnpm dev          # local dev server
pnpm test         # run unit tests
pnpm build        # production build to dist/
pnpm check        # svelte-check + tsc
pnpm format       # prettier
```

## Repo layout

```
.
├── app/                  # Svelte + Vite source
├── tools/                # build-time helpers (e.g. CNAME plugin)
├── helper/               # Python helper package (Plan 5)
├── templates/cf-worker/  # Cloudflare Worker template (Plan 6)
├── docs/
│   ├── superpowers/
│   │   ├── specs/        # design specs
│   │   └── plans/        # implementation plans
│   └── privacy.md        # (Plan 7)
└── .github/workflows/    # CI and deploy
```

## License

MIT — see [`LICENSE`](LICENSE).

## Status

Pre-1.0. Working title for the product is "BlueSky Saves Exporter"; a final brand name has not been chosen. The implementation rolls out across plans under `docs/superpowers/plans/`.
