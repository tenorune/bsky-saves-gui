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

5. **Verify with a dry run.** Add a small test file and a manifest under `coordination/test/` on the `coordination` branch (see [§Directory structure](#directory-structure-on-the-coordination-branch) below for the manifest shape). Trigger **Coordination PR** from the Actions tab, providing the manifest path as the input. Confirm a PR appears on this coord repo. Close that test PR without merging.

After setup, every cross-repo revision uses the same flow (see §[Round-trip](#round-trip)).

## Directory structure on the `coordination` branch

```
coordination/
└── <topic>/
    ├── <topic>.md                     # the team's draft of the canonical contract
    ├── <topic>-resolved.md            # the team's draft of the resolved-questions archive
    └── manifest.json                  # tells the workflow what to PR and what to call it
```

The contract filenames within each `<topic>/` directory should match the canonical filenames in this coord repo's `docs/` directory so the manifest's `source` → `target` mapping is mechanical.

The `manifest.json` is a small JSON file telling the workflow which files to PR and what the PR title should be:

```json
{
  "title": "GUI revision: session-mode TTL + clear-path correction",
  "files": [
    { "source": "coordination/installer-status-panel/installer-status-panel.md",          "target": "docs/installer-status-panel.md" },
    { "source": "coordination/installer-status-panel/installer-status-panel-resolved.md", "target": "docs/installer-status-panel-resolved.md" }
  ]
}
```

The workflow validates the manifest (parseable JSON, non-empty title, every source path is a non-empty file), then applies all listed files in one commit and opens a single PR. Multi-file PRs and single-file PRs use the same manifest shape — just one entry vs. many.

When a session revises a contract, it (a) fetches the current canonical from this coord repo via raw URL, (b) overwrites the corresponding file(s) under `coordination/<topic>/` on its primary repo's `coordination` branch, (c) updates `manifest.json` with the new title for this round, (d) commits and pushes, (e) the maintainer triggers the workflow with the manifest path.

## Round-trip

1. The maintainer asks one team's session to revise a contract.
2. The session `WebFetch`es the canonical from this coord repo's `main`:
   ```
   https://raw.githubusercontent.com/tenorune/bsky-saves-coordination/main/docs/<topic>.md
   https://raw.githubusercontent.com/tenorune/bsky-saves-coordination/main/docs/<topic>-resolved.md
   ```
3. Session drafts a revision (folds proposed changes into the body, adds entries to §Open questions, appends a §Changelog entry, moves closed items to the resolved archive). Overwrites `coordination/<topic>/<topic>.md` (and `-resolved.md` if changed) on the `coordination` branch. Updates `coordination/<topic>/manifest.json` with the new round's title.
4. Maintainer triggers **Coordination PR** from the primary repo's Actions tab, providing the manifest path (e.g. `coordination/<topic>/manifest.json`) as the input. Workflow reads the manifest, copies every listed file into its target, opens one PR on this coord repo.
5. Maintainer (optionally cross-checks with other sessions, fetches comments back manually) merges or requests further revisions.
6. Once merged, the next round starts at step 1 with whichever session needs to respond.

The coord repo's `main` branch is the **single source of truth**. Each session's `coordination/<topic>/` files are **transient drafts** that get overwritten on the next revision; only the merged version persists.

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
> - Your team's draft of any contract lives on the `coordination` branch of THIS primary repo, under `coordination/<topic>/<topic>.md`. A companion `manifest.json` in the same directory tells the workflow what to PR and what title to use.
> - To read other teams' merged changes: `WebFetch` the raw URL of the canonical doc on coord repo's `main`.
> - To push your revision: overwrite the draft(s) on the `coordination` branch, update `manifest.json` with the new round's title, ask the maintainer to trigger the **Coordination PR** workflow from the Actions tab with the manifest path.
> - Doc conventions are in the coord repo's README. Body = consensus. § Open questions = discussion. § Changelog = log. Companion `-resolved.md` = closed-questions archive.

## Current contracts

| Topic | Path | Owning teams | Status |
|---|---|---|---|
| Installer status panel | [`docs/installer-status-panel.md`](docs/installer-status-panel.md) + [`docs/installer-status-panel-resolved.md`](docs/installer-status-panel-resolved.md) | GUI + CLI + installer | Phase 1 drafting; Q5–Q8 open |

## The workflow

Drop this file into each primary repo at `.github/workflows/coordination-pr.yml` (on `main`). The git user-name strings reference `${{ github.repository }}` so the file is identical across all three primary repos — no per-repo customization needed.

The workflow is **manifest-driven**: one workflow input (the manifest path) ⇒ one PR with any number of files, single commit, title taken from the manifest. Whitespace in inputs is trimmed automatically. Title and file count are read once and exposed as step outputs, so titles with shell-special characters (`$`, backticks, etc.) are passed via env-var rather than embedded in `${{ }}` expressions on shell command lines — no shell-injection foot-gun.

```yaml
name: Coordination PR

# Pushes one or more coordination artifacts from this repo's
# `coordination` branch into `tenorune/bsky-saves-coordination` as a
# single PR. Designed for the multi-team coordination flow where each
# primary repo drafts amendments locally and the canonical contract
# lives in the neutral coordination repo.
#
# Manual trigger. Run from the Actions tab → "Coordination PR" →
# "Run workflow". You provide ONE input: the path to a JSON manifest
# on the coordination branch that lists the files to PR and the PR
# title. The workflow reads the manifest, copies each listed source
# into its target on a fresh coord-repo branch, single-commits, opens
# one PR.
#
# Manifest format (JSON):
#   {
#     "title": "PR title here",
#     "files": [
#       { "source": "coordination/foo/a.md", "target": "docs/a.md" },
#       { "source": "coordination/foo/b.md", "target": "docs/b.md" }
#     ]
#   }
#
# Secret required: BSKY_SAVES_COORDINATION_TOKEN (fine-grained PAT
# scoped to `tenorune/bsky-saves-coordination`, with Contents:
# read-and-write and Pull requests: read-and-write). When unset the
# workflow logs a warning and exits 0 — no failing red-X on the
# Actions tab.

on:
  workflow_dispatch:
    inputs:
      manifest:
        description: 'Path on the coordination branch to a JSON manifest listing files to push and the PR title. Example: coordination/installer-status-panel/manifest.json'
        required: true
        type: string
      source_ref:
        description: 'Branch in this repo to read source files (and the manifest) from. Defaults to the dedicated coordination branch.'
        required: false
        type: string
        default: coordination
      base:
        description: 'Base branch in the coord repo to PR against.'
        required: false
        type: string
        default: main

permissions:
  contents: read

jobs:
  open-coordination-pr:
    runs-on: ubuntu-latest
    env:
      # Job-level so step `if:` expressions can read it. Same pattern
      # as cross-repo release dispatch tokens.
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
          mft='${{ inputs.manifest }}'
          sref='${{ inputs.source_ref }}'
          bse='${{ inputs.base }}'
          trim() { printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
          {
            echo "manifest=$(trim "$mft")"
            echo "source_ref=$(trim "$sref")"
            echo "base=$(trim "$bse")"
          } >> "$GITHUB_OUTPUT"

      - name: Checkout this repo (coordination branch)
        if: env.COORD_TOKEN != ''
        uses: actions/checkout@v4
        with:
          ref: ${{ steps.clean.outputs.source_ref }}
          path: source-repo

      - name: Read and validate manifest
        if: env.COORD_TOKEN != ''
        id: manifest
        run: |
          MFT="source-repo/${{ steps.clean.outputs.manifest }}"
          if [ ! -f "$MFT" ]; then
            echo "::error::Manifest file not found: ${{ steps.clean.outputs.manifest }}"
            exit 1
          fi
          if ! jq empty "$MFT" 2>/dev/null; then
            echo "::error::Manifest is not valid JSON: ${{ steps.clean.outputs.manifest }}"
            exit 1
          fi
          TITLE="$(jq -r '.title // ""' "$MFT")"
          if [ -z "$TITLE" ]; then
            echo "::error::Manifest missing required field: title"
            exit 1
          fi
          FILES_COUNT="$(jq -r '.files | length' "$MFT")"
          if [ "$FILES_COUNT" -eq 0 ]; then
            echo "::error::Manifest field 'files' is empty"
            exit 1
          fi
          # Validate each source path resolves to a non-empty file.
          while IFS= read -r src; do
            if [ ! -f "source-repo/$src" ]; then
              echo "::error::Source file in manifest not found: $src"
              exit 1
            fi
            if [ ! -s "source-repo/$src" ]; then
              echo "::error::Source file in manifest is empty: $src"
              exit 1
            fi
          done < <(jq -r '.files[].source' "$MFT")
          # Expose title and file count for downstream steps.
          {
            echo "title<<__TITLE_EOF__"
            printf '%s\n' "$TITLE"
            echo "__TITLE_EOF__"
            echo "files_count=$FILES_COUNT"
          } >> "$GITHUB_OUTPUT"

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
          PRIMARY_REPO_SHORT: ${{ github.event.repository.name }}
          MANIFEST_PATH: ${{ steps.clean.outputs.manifest }}
          TITLE: ${{ steps.manifest.outputs.title }}
        run: |
          BRANCH="${PRIMARY_REPO_SHORT}/coordination-${GITHUB_RUN_ID}"
          git config user.name "${GITHUB_REPOSITORY} coordination workflow"
          git config user.email "${{ github.actor }}@users.noreply.github.com"
          git checkout -b "$BRANCH"
          MFT="../source-repo/${MANIFEST_PATH}"
          # Iterate every (source, target) pair. Tab-separated so paths
          # with embedded spaces work; jq emits a single tab between
          # the two values.
          jq -r '.files[] | "\(.source)\t\(.target)"' "$MFT" | while IFS=$'\t' read -r src tgt; do
            mkdir -p "$(dirname "$tgt")"
            cp "../source-repo/$src" "$tgt"
            git add "$tgt"
          done
          if git diff --cached --quiet; then
            echo "::warning::No effective changes — all source files match existing canonicals. Aborting PR creation."
            exit 0
          fi
          git commit -m "$TITLE"
          git push -u origin "$BRANCH"
          echo "BRANCH=$BRANCH" >> "$GITHUB_ENV"

      - name: Open PR via gh
        if: env.COORD_TOKEN != '' && env.BRANCH != ''
        working-directory: coord-repo
        env:
          GH_TOKEN: ${{ env.COORD_TOKEN }}
          MANIFEST_PATH: ${{ steps.clean.outputs.manifest }}
          TITLE: ${{ steps.manifest.outputs.title }}
          FILES_COUNT: ${{ steps.manifest.outputs.files_count }}
          BASE: ${{ steps.clean.outputs.base }}
        run: |
          MFT="../source-repo/${MANIFEST_PATH}"
          FILES_TABLE="$(
            echo "| Source (this repo) | Target (coord repo) |"
            echo "|---|---|"
            jq -r '.files[] | "| `\(.source)` | `\(.target)` |"' "$MFT"
          )"
          BODY="$(cat <<EOF
          Opened automatically by ${GITHUB_REPOSITORY}'s coordination workflow.

          **Manifest:** [\`${MANIFEST_PATH}\`](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/blob/${GITHUB_SHA}/${MANIFEST_PATH}) in ${GITHUB_REPOSITORY} @ \`${GITHUB_SHA}\`

          **Files in this PR (${FILES_COUNT}):**

          ${FILES_TABLE}

          **Workflow run:** ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}

          See the cross-repo coordination process in the coord repo's README for context.
          EOF
          )"
          gh pr create \
            --repo tenorune/bsky-saves-coordination \
            --base "$BASE" \
            --head "$BRANCH" \
            --title "$TITLE" \
            --body "$BODY"
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
