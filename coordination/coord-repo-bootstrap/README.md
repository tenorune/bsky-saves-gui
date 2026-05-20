# bsky-saves-coordination

Canonical cross-repo contracts for the **bsky-saves** project trio: the browser PWA, the Python helper / CLI, and the native installer. This repo is the neutral fourth workspace where contracts that span the three primary repos live.

If you're a maintainer onboarding a new Claude session for one of the primary repos, **start with §[For Claude sessions](#for-claude-sessions) below** — paste the linked snippet into the session and follow the setup steps.

---

## What this repo holds

- `docs/` — the canonical version of every cross-repo contract document. Each contract is a markdown file with a body, an open-questions section, and a changelog. Companion `<topic>-resolved.md` files archive closed questions as a design-rationale record.
- `README.md` (this file) — onboarding doc + workflow template for primary repos.

## Why this exists

Anthropic limits each Claude session to one repository's worth of GitHub MCP scope. A GUI-session agent can't PR directly into the CLI repo. A CLI-session agent can't read review comments on a PR opened by a different session. Direct cross-repo coordination through PR comments doesn't work for multi-session work.

The mechanism we use instead is a **versioned-document protocol**: each session writes its proposed revision of a shared markdown doc to its own primary repo (on a dedicated `coordination` branch), a one-shot workflow PRs that revision into this coord repo, the maintainer reviews and merges. The doc IS the conversation — proposals, questions, and resolutions are encoded in the markdown body and structured sections, not in PR comments. Any session can then read the latest canonical version via raw URL.

## The three teams

| Repo | Role | Source path for drafts | Workflow on `main`? |
|---|---|---|---|
| `tenorune/bsky-saves-gui` | Browser PWA, Svelte / Vite | `coordination` branch, `coordination/<topic>/<file>.md` | yes |
| `tenorune/bsky-saves` | Helper daemon + CLI, Python | `coordination` branch, `coordination/<topic>/<file>.md` | yes |
| `tenorune/bsky-saves-install` | Native installer + tray panel | `coordination` branch, `coordination/<topic>/<file>.md` | yes |

Each primary repo has the same setup. Their `coordination` branches are **never merged to main**.

## Setup for a primary repo (one-time per team)

1. **Create a long-lived `coordination` branch** off `main`. This branch holds the team's drafts of contract docs and is never merged.

   ```
   git checkout main && git pull
   git checkout -b coordination
   mkdir -p coordination
   # add coordination/README.md (boilerplate; see "Directory structure" below)
   git push -u origin coordination
   ```

2. **Add the workflow** `.github/workflows/coordination-pr.yml` on `main` (paste from [§The workflow](#the-workflow) below). Open a PR, merge.

3. **Get the PAT.** The maintainer issues a single fine-grained personal access token (`github_pat_…`) scoped to `tenorune/bsky-saves-coordination` only, with Contents: read-and-write and Pull requests: read-and-write. Same PAT works for all three repos because it's scoped to the destination.

4. **Install the PAT as a secret.** Repo settings → Secrets and variables → Actions → New repository secret. Name: `BSKY_SAVES_COORDINATION_TOKEN`. Value: the PAT.

5. **Verify with a dry run.** Add a small file to the `coordination` branch under `coordination/test/hello.md`. Trigger **Coordination PR** from the Actions tab. Confirm a PR appears on this coord repo. Close that test PR without merging.

After setup, every cross-repo revision uses the same flow (see §[Round-trip](#round-trip)).

## Directory structure on the `coordination` branch

```
coordination/
├── README.md                          # team's local notes about the convention
└── <topic>/
    ├── <topic>.md                     # the team's draft of the canonical contract
    └── <topic>-resolved.md            # the team's draft of the resolved-questions archive
```

The filename within each `<topic>/` directory should match the canonical filename in this coord repo's `docs/` directory, so the workflow's source-to-target mapping is mechanical.

When a session revises a contract, it (a) fetches the current canonical from this coord repo via raw URL, (b) overwrites the corresponding file under `coordination/<topic>/` on its primary repo's `coordination` branch, (c) commits and pushes, (d) the maintainer triggers the workflow.

## Round-trip

1. The maintainer asks one team's session to revise a contract.
2. The session `WebFetch`es the canonical from this coord repo's `main`:
   ```
   https://raw.githubusercontent.com/tenorune/bsky-saves-coordination/main/docs/<topic>.md
   https://raw.githubusercontent.com/tenorune/bsky-saves-coordination/main/docs/<topic>-resolved.md
   ```
3. Session drafts a revision (folds proposed changes into the body, adds entries to §Open questions, appends a §Changelog entry, moves closed items to the resolved archive). Commits to its `coordination` branch under `coordination/<topic>/<topic>.md` (and `-resolved.md` if needed).
4. Maintainer triggers **Coordination PR** from the primary repo's Actions tab. Workflow opens a PR on this coord repo.
5. Maintainer (optionally cross-checks with other sessions, fetches comments back manually) merges or requests further revisions.
6. Once merged, the next round starts at step 1 with whichever session needs to respond.

The coord repo's `main` branch is the **single source of truth**. Each session's `coordination/<topic>/` file is a **transient draft** that's overwritten on the next revision; only the merged version persists.

## Doc conventions

Every contract doc under `docs/<topic>.md` follows the same shape:

- **§§1–N body** — consensus-only content. Edits to the body imply agreement across teams.
- **§ Open questions** — active discussion. Each entry has `**Raised by:** <team> (<date>)`, context, current proposals from each team, and `**Status:** unresolved / proposed-by-<team>`. Numbered Q1, Q2, … When closed, the entry moves to the companion `-resolved.md` (renamed R1, R2, …).
- **§ Changelog** — table of who changed what when. New entries append at the bottom.

The companion `<topic>-resolved.md`:

- Append-only.
- Each entry: who raised it, who resolved it, the question, the resolution.
- Body of the main doc references back via `(see R<n>)` when rationale matters.

## For Claude sessions

When opening a session to work on cross-repo coordination, paste this into the first message after setup:

> The bsky-saves project uses a shared coordination repo (`tenorune/bsky-saves-coordination`) for cross-repo design docs. See its README for the way of working. The short version:
>
> - The canonical contract for each topic lives in `tenorune/bsky-saves-coordination/docs/<topic>.md`.
> - Your team's draft of any contract lives on the `coordination` branch of THIS primary repo, under `coordination/<topic>/<topic>.md`.
> - To read other teams' merged changes: `WebFetch` the raw URL of the canonical doc on coord repo's `main`.
> - To push your revision: overwrite the draft on the `coordination` branch in this repo, then ask the maintainer to trigger the **Coordination PR** workflow from the Actions tab.
> - Doc conventions are in the coord repo's README. Body = consensus. § Open questions = discussion. § Changelog = log. Companion `-resolved.md` = closed-questions archive.

## Current contracts

| Topic | Path | Owning teams | Status |
|---|---|---|---|
| Installer status panel | [`docs/installer-status-panel.md`](docs/installer-status-panel.md) + [`docs/installer-status-panel-resolved.md`](docs/installer-status-panel-resolved.md) | GUI + CLI + installer | Phase 1 drafting; Q5–Q8 open |

## The workflow

Drop this file into each primary repo at `.github/workflows/coordination-pr.yml` (on `main`). The git user-name strings reference `${{ github.repository }}` so the file is identical across all three primary repos — no per-repo customization needed.

The workflow trims whitespace from all inputs (paste-and-go sometimes adds a leading space; trimming once at the top keeps every downstream step working).

```yaml
name: Coordination PR

# Pushes a coordination artifact (typically a fully revised cross-repo
# contract doc) from this repo into `tenorune/bsky-saves-coordination`
# as a PR. Designed for the multi-team coordination flow where each
# primary repo (gui / cli / installer) drafts amendments locally and
# the canonical contract lives in the neutral coordination repo.
#
# Manual trigger only. Run from the Actions tab → "Coordination PR" →
# "Run workflow". You'll be asked for:
#   - source: path in this repo to the artifact (e.g.
#     coordination/installer-status-panel/installer-status-panel.md)
#   - target: path in the coord repo to write to (e.g.
#     docs/installer-status-panel.md)
#   - title:  PR title
#
# The workflow creates a fresh branch in the coord repo named
# `<this-repo>/coordination-<run-id>`, copies the source over the target,
# commits, and opens a PR.
#
# Secret required: BSKY_SAVES_COORDINATION_TOKEN (fine-grained PAT scoped
# to `tenorune/bsky-saves-coordination`, with Contents: read-and-write
# and Pull requests: read-and-write). When the secret is absent the
# workflow exits with a warning instead of failing.

on:
  workflow_dispatch:
    inputs:
      source_ref:
        description: 'Branch in this repo to read the source file from. Coordination artifacts live on the long-lived `coordination` branch by design — they never touch main.'
        required: false
        type: string
        default: coordination
      source:
        description: 'Path in this repo (under source_ref) to the artifact to push (e.g. coordination/installer-status-panel/installer-status-panel.md)'
        required: true
        type: string
      target:
        description: 'Path in the coord repo to write to (e.g. docs/installer-status-panel.md)'
        required: true
        type: string
      title:
        description: 'PR title'
        required: true
        type: string
      base:
        description: 'Base branch in coord repo to PR against'
        required: false
        type: string
        default: main

permissions:
  contents: read

jobs:
  open-coordination-pr:
    runs-on: ubuntu-latest
    env:
      # Job-level so step `if:` expressions can read it. Same pattern as
      # cross-repo release dispatch tokens.
      COORD_TOKEN: ${{ secrets.BSKY_SAVES_COORDINATION_TOKEN }}
    steps:
      - name: Check secret presence
        if: env.COORD_TOKEN == ''
        run: |
          echo "::warning::BSKY_SAVES_COORDINATION_TOKEN is unset. Configure it as a repo secret to enable cross-repo coordination PRs."
          echo "Skipping PR step. See the coord repo's README for setup."
          exit 0

      - name: Sanitize inputs (strip leading/trailing whitespace)
        if: env.COORD_TOKEN != ''
        id: clean
        run: |
          src='${{ inputs.source }}'
          tgt='${{ inputs.target }}'
          ttl='${{ inputs.title }}'
          sref='${{ inputs.source_ref }}'
          bse='${{ inputs.base }}'
          trim() { printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
          {
            echo "source=$(trim "$src")"
            echo "target=$(trim "$tgt")"
            echo "title=$(trim "$ttl")"
            echo "source_ref=$(trim "$sref")"
            echo "base=$(trim "$bse")"
          } >> "$GITHUB_OUTPUT"

      - name: Checkout this repo (coordination branch)
        if: env.COORD_TOKEN != ''
        uses: actions/checkout@v4
        with:
          ref: ${{ steps.clean.outputs.source_ref }}
          path: source-repo

      - name: Validate source file exists
        if: env.COORD_TOKEN != ''
        run: |
          if [ ! -f "source-repo/${{ steps.clean.outputs.source }}" ]; then
            echo "::error::Source file not found: ${{ steps.clean.outputs.source }}"
            exit 1
          fi
          if [ ! -s "source-repo/${{ steps.clean.outputs.source }}" ]; then
            echo "::error::Source file is empty: ${{ steps.clean.outputs.source }}"
            exit 1
          fi

      - name: Checkout coordination repo
        if: env.COORD_TOKEN != ''
        uses: actions/checkout@v4
        with:
          repository: tenorune/bsky-saves-coordination
          token: ${{ env.COORD_TOKEN }}
          path: coord-repo
          ref: ${{ steps.clean.outputs.base }}

      - name: Apply changes and push branch
        if: env.COORD_TOKEN != ''
        working-directory: coord-repo
        env:
          # Strip the owner prefix so the branch name is just the repo
          # short-name. e.g. "tenorune/bsky-saves-gui" → "bsky-saves-gui".
          PRIMARY_REPO_SHORT: ${{ github.event.repository.name }}
        run: |
          BRANCH="${PRIMARY_REPO_SHORT}/coordination-${GITHUB_RUN_ID}"
          git config user.name "${GITHUB_REPOSITORY} coordination workflow"
          git config user.email '${{ github.actor }}@users.noreply.github.com'
          git checkout -b "$BRANCH"
          # mkdir -p so the workflow handles a target path one or more
          # directories deep (e.g. docs/foo/bar.md) on a clean repo
          # where the parent doesn't yet exist.
          mkdir -p "$(dirname "${{ steps.clean.outputs.target }}")"
          cp "../source-repo/${{ steps.clean.outputs.source }}" "${{ steps.clean.outputs.target }}"
          git add "${{ steps.clean.outputs.target }}"
          if git diff --cached --quiet; then
            echo "::warning::No changes to ${{ steps.clean.outputs.target }} — source matches existing canonical. Aborting PR creation."
            exit 0
          fi
          git commit -m "${{ steps.clean.outputs.title }}"
          git push -u origin "$BRANCH"
          echo "BRANCH=$BRANCH" >> "$GITHUB_ENV"

      - name: Open PR via gh
        if: env.COORD_TOKEN != '' && env.BRANCH != ''
        working-directory: coord-repo
        env:
          GH_TOKEN: ${{ env.COORD_TOKEN }}
        run: |
          gh pr create \
            --repo tenorune/bsky-saves-coordination \
            --base "${{ steps.clean.outputs.base }}" \
            --head "${BRANCH}" \
            --title "${{ steps.clean.outputs.title }}" \
            --body "$(cat <<EOF
          Opened automatically by ${GITHUB_REPOSITORY}'s coordination workflow.

          **Source:** [\`${{ steps.clean.outputs.source }}\`](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/blob/${{ github.sha }}/${{ steps.clean.outputs.source }}) in ${GITHUB_REPOSITORY} @ \`${{ github.sha }}\`

          **Workflow run:** ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}

          See the cross-repo coordination process in this repo's README for context.
          EOF
          )"
```

## Glossary

- **CLI** — the `bsky-saves` command and its subcommands (`fetch`, `hydrate`, `enrich`, `serve`, `token`).
- **Helper** — the long-running HTTP daemon started by the `bsky-saves serve` CLI subcommand. Listens on `127.0.0.1:47826`.
- **GUI** — the `bsky-saves-gui` Svelte/Vite static web app, distributed both bundled into the `bsky-saves` wheel and hosted at `https://saves.lightseed.net`.
- **Installer** — the native menu-bar / tray application that bundles the helper and the GUI as a single OS-level install. Lives in `tenorune/bsky-saves-install`.
- **Coord repo** — this repo. `tenorune/bsky-saves-coordination`. Holds the canonical contract docs.
- **Primary repo** — one of `bsky-saves-gui`, `bsky-saves`, `bsky-saves-install`.
- **Coordination branch** — the long-lived `coordination` branch on each primary repo holding that team's drafts. Never merged.
- **Contract** — a markdown doc in `docs/<topic>.md` describing the shape of an interface or protocol that spans more than one primary repo.
