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
slash command automates it). The fork is **rebased** onto the latest release
tag, so your commits stay on top and upstream history sits below — your real
commits are the patches, so the rebase replays them directly:

1. `git fetch upstream --tags`.
2. Pick the latest stable `release-X.Y.Z` tag.
3. `git rebase <release-tag>` to replay the fork's own commits on top.
   - If a commit conflicts, open the matching `NNN-*.md` (match the conflicting
     files against its **Touched files**), re-implement the intent against the
     new upstream code, stage it, and `git rebase --continue`. The `.md` is the
     source of truth, not the on-disk `.patch`.
4. Regenerate each `NNN-*.patch` from its touched files against the release tag
   so the recorded diffs stay current.
5. Run typecheck / lint / the smoke test described in each patch's `.md`.
6. Force-push to `origin` with `--force-with-lease` (the rebase rewrote history).

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
