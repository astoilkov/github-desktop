# /sync-fork

Pull the latest commits from the `upstream` remote into the current fork branch
and reapply (or, on drift, re-derive) every patch in `fork/patches/` using the
matching `.md` as the source of truth.

## Preconditions

Before doing anything, verify and stop with a clear message if any fails:

- Working tree is clean (`git status --porcelain` is empty). Do not stash for
  the user — ask them what to do.
- An `upstream` remote exists (`git remote get-url upstream`).
- `fork/patches/README.md` exists. Read it so the workflow matches the
  fork's documented conventions.
- At least one `fork/patches/NNN-*.md` exists.

## Steps

1. Identify the current branch (`git branch --show-current`) and the upstream
   tracking branch. Default to `upstream/development`; if `git remote show upstream`
   indicates a different default branch, use that. Confirm with the user only
   if ambiguous.

2. `git fetch upstream`. If the fetch yields no new commits and every patch
   already applies in reverse (see step 4), tell the user the fork is already
   in sync and exit.

3. Merge upstream into the current branch with a merge commit so the fork
   history stays linear-ish and reviewable:
   `git merge <upstream-ref> --no-ff -m "Sync with <upstream-ref>"`.
   If merge conflicts occur, resolve them by reading the conflicting hunks
   together with any `fork/patches/*.md` whose `Touched files` overlap. If
   the right resolution isn't clear, ask the user before picking a side.

4. For each `fork/patches/NNN-*.patch` in numeric order, decide its state:

   - `git apply --check --reverse fork/patches/NNN-*.patch` exits 0
     → **already applied** (the merge preserved it). Skip; record as such.

   - Otherwise, `git apply --check fork/patches/NNN-*.patch` exits 0
     → **applies cleanly**. Run `git apply fork/patches/NNN-*.patch` and
     stage the result.

   - Both checks fail → **drifted**. Read the matching `NNN-*.md`, locate
     the symbols / anchors named in its `Touched files` and `Change summary`
     sections in the current codebase, and re-implement the change there
     (the `.md` is the source of truth, not the `.patch`). Then regenerate
     the patch from the new diff so the next sync starts from a clean
     baseline:

     ```sh
     git diff <touched files> > fork/patches/NNN-<slug>.patch
     ```

   Report each patch's status as you go: `already-applied`, `applied-cleanly`,
   or `re-derived (regenerated .patch)`.

5. Stage every modified application file and any regenerated `.patch` files.
   Create one commit:
   `Sync upstream/<branch> and reapply fork patches`.
   Do **not** amend the merge commit; keep them separate so the history is
   readable.

6. **Do not push.** Print:
   - The merge commit and the patch-apply commit hashes.
   - The status table from step 4.
   - A single concatenated checklist built from the `## Verify` section of
     every patch's `.md`, so the user has one place to look for smoke tests.

## Rules

- Never use `--force`, `--hard`, or any destructive flag. The drift-recovery
  branch in step 4 handles patch failures without rewriting history.
- Never push, open a PR, or run `gh` write commands. The user reviews and
  pushes themselves.
- If a patch's `.md` is missing or doesn't follow the format documented in
  `fork/patches/README.md`, stop and ask the user how to proceed.
- Run typecheck / lint only if the user asks; the verify checklist tells them
  what to run after reviewing.
