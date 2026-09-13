# Nested Tags and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add nested tag management, immutable timer-session history, priorities, due dates, and a monthly calendar with daily timelines.

**Architecture:** Keep timer runtime state in the existing timer JSON rows. Add pure tag/session/calendar helpers, and persist immutable session snapshots plus a small tag catalog and account timezone in dedicated RLS tables. Guest data uses localStorage and is imported on sign-in through the existing merge flow.

**Tech Stack:** Vanilla JavaScript, CSS, Node test runner, Supabase Postgres/Auth/Realtime, Vite PWA.

---

### Task 1: Lock behavior with QA and unit tests

**Files:**
- Create: `QA.md`
- Create: `tests/history.test.js`
- Modify: `tests/model.test.js`

- [x] Test tag normalization, descendant queries, prefix rename/merge, session thresholds, snapshot immutability, overlap union, timezone day splitting, and timeline columns.
- [x] Run `npm test`; expect failures because `src/history.js` and session-aware model exports do not exist.

### Task 2: Add pure history and timer-state logic

**Files:**
- Create: `src/history.js`
- Modify: `src/model.js`
- Test: `tests/history.test.js`, `tests/model.test.js`

- [x] Implement canonical tag paths with `normalizeTag()`, descendant matching with `tagMatches()`, and current-path replacement with `replaceTagPrefix()`.
- [x] Extend timers with `tags`, `dueDate`, `priority`, and an active session containing an ID, immutable snapshot, and closed active segments.
- [x] Make `transition()` retain one session across pauses shorter than 10 seconds and create a new session after longer pauses.
- [x] Implement `sessionRecord()` so completed timers clip the last segment at the countdown deadline and records below 10 seconds return `null`.
- [x] Implement timezone day splitting, overlap-union totals, and deterministic overlapping-column layout.
- [x] Run `npm test`; expect all unit tests to pass.

### Task 3: Add secure cloud persistence

**Files:**
- Create: `supabase/migrations/*_nested_tags_history.sql` using `supabase migration new nested_tags_history`
- Modify: `src/cloud.js`
- Modify: `tests/database.sql`
- Modify: `tests/cloud.mjs`

- [x] Create `tempo_tags`, `tempo_sessions`, and `tempo_profiles` with explicit grants, ownership indexes, checks, and RLS ownership policies.
- [x] Add an invoker-rights tag merge RPC that maps a source prefix and descendants into a target prefix, deduplicates current timer tags, archives sources, and leaves session snapshots untouched.
- [x] Add idempotent session upsert that keeps the record with the greatest active duration for a session ID.
- [x] Add client reads/writes and Postgres Changes listeners for tags, sessions, and profiles.
- [x] Extend SQL QA to prove cross-account isolation, session idempotency, and tag-merge snapshot preservation.
- [x] Apply the reviewed migration to project `hgqntslhgrbwkmuqpfbr`, run database QA, then run Supabase security and performance advisors.

### Task 4: Add minimal management and calendar UI

**Files:**
- Modify: `src/main.js`
- Modify: `src/style.css`
- Modify: `tests/browser.mjs`

- [x] Add timer/calendar view buttons. Keep the existing timer grid as the default view.
- [x] Add block fields for multiple tags, due date, and priority; show compact metadata on cards.
- [x] Add tag catalog and timezone controls to settings, including archive and rename/merge.
- [x] Record sessions on pause, completion, reset, mode switch, and deletion; upsert locally first and then to Supabase.
- [x] Render a seven-column month grid with filtered per-day session minutes, overlap-safe daily totals, and due items.
- [x] Render the selected day in a dialog with a 24-hour vertical timeline, side-by-side overlaps, and per-session deletion.
- [x] Import guest tags and sessions during Google sign-in and preserve history when blocks are deleted.
- [x] Run browser QA at desktop and 390px mobile widths.

### Task 5: Full validation and release

**Files:**
- Modify: `QA.md`

- [x] Run unit, build, browser, cloud, database, and push regression checks; mark each proven QA item.
- [x] Verify a fresh browser and existing legacy localStorage both load without recovery loss.
- [x] Push to `main`, wait for GitHub Pages deployment, and run the core timer/tag/calendar flow against the live URL.

