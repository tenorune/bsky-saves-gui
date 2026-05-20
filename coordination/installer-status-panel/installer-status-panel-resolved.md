# Installer status panel — resolved-questions archive

> **Companion to:** [`installer-status-panel.md`](./installer-status-panel.md). Holds closed questions and their resolutions as a design-rationale archive.
> **Convention:** entries are append-only. Don't edit a resolved entry's text; if a decision is revisited, log a new entry with cross-references.
> **Workflow:** when a question in the main doc's §7 closes, its content moves here (renamed `R<n>`) and the resolution gets folded into the main doc's body (or §4.x as applicable). The main doc's body references back here via `(see R<n>)` when the rationale matters.

---

## R1 — Push trigger set

**Raised by:** CLI (2026-05-17) as §7 Q1.
**Resolved by:** GUI (2026-05-18) in §4.3.

**Question:** What triggers a status push from the GUI? End of every successful fetch + every hydrate cycle is the obvious set. Should the GUI also push on idle-tick, on unpair / clear-data events, on backup-toggle changes?

**Resolution:** Required triggers documented in §4.3:
- Successful fetch
- Each per-asset hydration phase complete
- Toggle on/off for any of {threads, images, articles}
- Sign-in (initial snapshot carrying the new DID)
- "Clear all data" — sends `DELETE /status` rather than a regular push

Plus, in session mode only:
- Idle heartbeat at ~15s cadence to keep the helper's TTL alive

Sign-out is explicitly NOT a trigger (it stops the push loop but doesn't clear; see R5).

---

## R2 — Payload contents

**Raised by:** CLI (2026-05-17) as §7 Q2.
**Resolved by:** GUI (2026-05-18) in §4.4.

**Question:** What's in the payload? The §4.4 starter set is a proposal. The GUI team owns the final field list.

**Resolution:** §4.4 of the main doc holds the final phase-1 shape. GUI additions over the CLI's starter set:
- `current_state` ∈ `{"idle", "refreshing", "hydrating", "error"}` — gives the panel a live signal without inferring from `last_activity.finished_at`.
- `storage.session_ttl_seconds` — pairs with `storage.mode === "session"` to advertise the helper TTL value the GUI is choosing.
- `last_activity.errors` clarified to `{kind, message, count}` object shape rather than an unspecified array.

Any future additions follow the `schema_version` bump rules in §4.4 notes.

---

## R3 — Multiple GUI sessions on one helper

**Raised by:** CLI (2026-05-17) as §7 Q3.
**Resolved by:** Joint (2026-05-18) — GUI ratified what CLI proposed.

**Question:** Multi-browser users (or maintainer-style multi-account setups) push to the same helper. Last-write-wins vs. keyed by `did`.

**Resolution:** Phase 1: last-write-wins, single-slot. The payload always carries `library.did` for forward-compat. Phase 3 (multi-handle / CLI-inventory work) layers per-DID indexing on top without a contract break — `GET /status?did=...` or a list-shaped response are both available as later extensions.

---

## R4 — Pyodide-fallback mode

**Raised by:** CLI (2026-05-17) as §7 Q4.
**Resolved by:** CLI (2026-05-17) in §4.3.

**Question:** GUI in Pyodide-fallback mode (no helper to push to).

**Resolution:** Status push is skipped. The panel — if anyone is viewing it via the bundled-GUI / installer flow — displays last-known status from the prior paired session, with a stale timestamp surfacing the staleness. Documented limitation; not a bug.

---

## R5 — Clear-path semantics: only "Clear all data", not sign-out

**Raised by:** GUI (2026-05-18) during scope refinement.
**Resolved by:** Joint (2026-05-18).

**Question:** Initial GUI proposal treated both sign-out and "Clear all data" as triggers for `DELETE /status`. Tenorune corrected: in the GUI, sign-out preserves local library data; only "Clear all data" wipes it.

**Resolution:** Only "Clear all data" sends `DELETE /status`. Sign-out stops the push loop without clearing. The helper's response per mode:
- **Persist mode after sign-out**: snapshot stays on disk. Panel keeps showing it until "Clear all data" or a new sign-in with a different DID overwrites it.
- **Session mode after sign-out**: heartbeats stop, TTL fires within ~60s, helper drops the in-memory snapshot, panel goes blank.

This mirrors the GUI's own persist/session contract: the user's local library outlives sign-out in persist mode, and is transient in session mode. The helper snapshot's lifecycle tracks that exactly.
