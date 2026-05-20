# `coordination/` — cross-repo coordination drafts

Working drafts of cross-repo coordination documents. Each file under this
directory is a GUI-team draft that will be PRed into
[`tenorune/bsky-saves-coordination`](https://github.com/tenorune/bsky-saves-coordination)
via `.github/workflows/coordination-pr.yml`.

This branch (`coordination`) is dedicated to coordination artifacts only —
it is never merged into `main`. The workflow lives on `main` (so it shows
up in the Actions tab) but reads its source files from this branch.

## Layout

```
coordination/
├── README.md                          # this file
└── <topic>/
    ├── installer-status-panel.md          # current GUI-team revision
    └── installer-status-panel-resolved.md # closed-questions archive
```

The filename within each `<topic>/` directory matches the canonical
filename in the coord repo's `docs/` directory. The workflow copies the
file as-is (no transformation); whoever drafts is responsible for the
final shape of the canonical doc.

## How a coordination round works

1. The other team's session (CLI or installer) revises the canonical doc
   in `tenorune/bsky-saves-coordination` and opens a PR.
2. The maintainer merges it.
3. The GUI session (here) fetches the now-current canonical doc via raw
   URL and reads it.
4. The GUI session writes a revised version into
   `coordination/<topic>/<artifact>.md` on this branch, commits, pushes.
5. The maintainer triggers `Coordination PR` from this repo's Actions tab
   with the file path. The workflow opens a PR on the coord repo.
6. Other teams review, propose further revisions in their own sessions.

The convention for the contract doc is:

- **Body sections** hold consensus content only. Edits to the body
  represent agreement; revisions arrive as PRs in the coord repo for
  team review.
- **Open questions** section at the bottom holds active discussion,
  attributed and dated.
- **Changelog** section logs who added what when.
- **Companion `-resolved.md`** holds closed questions and their
  resolutions as a design-rationale archive.

When an Open question closes, the proposer makes a single revision that
(a) folds the resolution into the body, (b) removes the question from
Open questions, (c) appends the question + resolution to the
`-resolved.md` companion.
