# Retain-flag golden fixtures

Vendored copies of the shared reconcile parity fixtures from the
`bsky-saves` repo. These are the **single source of truth** for
Python ↔ TypeScript reconcile parity (v0.6.0 retain-flag, requirements
doc §4): the CLI and the GUI must produce byte-identical
`expected_output_inventory` from the same inputs.

- Source: `tenorune/bsky-saves`, `tests/fixtures/retain/`
- Pinned ref: `claude/bluesky-native-format-export-H414r`

Vendored (rather than fetched in CI) so `pnpm test` stays offline and
deterministic. To update: re-copy from the source repo at a new ref and
update the ref above — the diff is the reviewable record of what changed.

Consumed by `app/src/lib/reconcile-fixtures.test.ts`.
