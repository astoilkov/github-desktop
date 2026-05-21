# Fork patches

This folder is the record of every long-lived modification this fork carries
on top of upstream `desktop/desktop`. Each patch lives as a pair of files:

- `NNN-short-name.md` — the **intent**: what the patch does, why it exists, where
  it touches the codebase, and how to verify it. Survives upstream drift.
- `NNN-short-name.patch` — the **mechanical diff**, produced by `git diff` or
  `git format-patch`. Applies cleanly when upstream hasn't moved the affected
  lines; otherwise the `.md` is the source of truth and the patch is re-derived.

Patches are numbered in the order they were introduced.

## Workflow

When upstream releases new commits, sync the fork like this (the `/sync-fork`
slash command automates it):

1. `git fetch upstream`
2. Merge or rebase `upstream/development` into the fork branch.
3. For each patch in this folder, in numeric order:
   - Try `git apply --check fork/patches/NNN-*.patch`.
   - If it applies cleanly, `git apply` it and stage the changes.
   - If it fails, open the matching `NNN-*.md`, locate the anchors it names
     in the current codebase, and re-implement the intent. Then regenerate
     the `.patch` so the next sync starts from a clean baseline.
4. Run typecheck / lint / the smoke test described in each patch's `.md`.
5. Commit, push to `origin`.

## Adding a new patch

1. Make the code change on the fork branch (any normal edit flow).
2. Pick the next number `NNN` and a short slug.
3. Write `fork/patches/NNN-slug.md` with the sections below.
4. Capture the diff: `git diff <files> > fork/patches/NNN-slug.patch`.
5. Commit both files alongside the code change.

### `.md` structure

Every patch markdown must have these sections so the sync workflow (and humans)
can act on it without reading the diff:

- **Goal** — one paragraph: what behavior this adds or changes, and why.
- **Upstream link** — issue / PR / discussion reference, if any.
- **Touched files** — bullet list of files with the named function / section
  inside each one (e.g. "`handleAppURL` in `main.ts`"). Anchor by symbol name,
  not line number — line numbers rot.
- **Change summary** — for each touched file, the *semantic* change ("gate the
  `window.focus()` call on the new `openInBackground` flag"), not a line-by-line
  retell of the diff.
- **Verify** — concrete steps a human can run to confirm the patch still works
  after sync (a command, a URL to open, an expected observable).
