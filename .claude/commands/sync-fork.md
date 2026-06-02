# /sync-fork

Pull commits from the `upstream` remote into the current fork branch **only up to
the latest tagged GitHub Desktop release** (not the bleeding edge of the upstream
branch), and reapply (or, on drift, re-derive) every patch in `fork/patches/`
using the matching `.md` as the source of truth.

We deliberately sync to a released tag rather than the branch HEAD so the fork
always tracks a shipped, stable version instead of unreleased work-in-progress.

## Preconditions

Before doing anything, verify and stop with a clear message if any fails:

- Working tree is clean (`git status --porcelain` is empty). Do not stash for
  the user — ask them what to do.
- An `upstream` remote exists (`git remote get-url upstream`).
- `fork/patches/README.md` exists. Read it so the workflow matches the
  fork's documented conventions.
- At least one `fork/patches/NNN-*.md` exists.

## Steps

1. Identify the current branch (`git branch --show-current`).

2. `git fetch upstream --tags --prune`. This brings in both the upstream branch
   and every release tag.

3. Determine the **latest GitHub Desktop release tag** — this is the sync target,
   not the upstream branch HEAD. Upstream tags releases as `release-X.Y.Z` (the
   same versions listed at https://github.com/desktop/desktop/tags). Pick the
   highest semantic version, ignoring pre-release/beta/draft tags if a stable one
   is higher:

   ```sh
   git tag -l 'release-*' --sort=-version:refname | head -20
   ```

   Take the first stable (non `-beta`/`-test`/`-draft`) tag as `<release-tag>`.
   If the most recent tags are ambiguous (e.g. a beta sorts above the latest
   stable, or naming doesn't match `release-*`), confirm the chosen tag with the
   user before merging. Record the resolved version for the final report.

4. If the current branch already contains `<release-tag>`
   (`git merge-base --is-ancestor <release-tag> HEAD` exits 0) and every patch
   already applies in reverse (see step 5), tell the user the fork is already in
   sync with the latest release and exit.

5. Merge the release tag — and **only** up to that tag — into the current branch
   with a merge commit so the fork history stays linear-ish and reviewable:
   `git merge <release-tag> --no-ff -m "Sync with <release-tag>"`.
   Because the target is a tag rather than the branch tip, commits upstream has
   made after that release are intentionally left out. If merge conflicts occur,
   resolve them using the conflict-resolution methodology in the
   `/git-rebase-autofix` command (its **Context Gathering** and **Resolution
   Strategy** sections — gather full context from both sides, preserve the intent
   of each, don't blindly pick a side), reading the conflicting hunks together
   with any `fork/patches/*.md` whose `Touched files` overlap. If the right
   resolution isn't clear, ask the user before picking a side.

6. For each `fork/patches/NNN-*.patch` in numeric order, decide its state:

   - `git apply --check --reverse fork/patches/NNN-*.patch` exits 0
     → **already applied** (the merge preserved it). Skip; record as such.

   - Otherwise, `git apply --check fork/patches/NNN-*.patch` exits 0
     → **applies cleanly**. Run `git apply fork/patches/NNN-*.patch` and
     stage the result.

   - Both checks fail → **drifted** (the patch conflicts with the synced code).
     Resolve it using the conflict-resolution methodology in the
     `/git-rebase-autofix` command (its **Context Gathering** and **Resolution
     Strategy** sections): understand the semantic intent of both the patch and
     the upstream change before reconciling them, and preserve improvements from
     both sides rather than picking one. Concretely: read the matching `NNN-*.md`,
     locate the symbols / anchors named in its `Touched files` and `Change
     summary` sections in the current codebase, and re-implement the change there
     (the `.md` is the source of truth, not the `.patch`). Then regenerate
     the patch from the new diff so the next sync starts from a clean
     baseline:

     ```sh
     git diff <touched files> > fork/patches/NNN-<slug>.patch
     ```

   Report each patch's status as you go: `already-applied`, `applied-cleanly`,
   or `re-derived (regenerated .patch)`.

7. Stage every modified application file and any regenerated `.patch` files.
   Create one commit:
   `Reapply fork patches after syncing <release-tag>`.
   Do **not** amend the merge commit; keep them separate so the history is
   readable.

8. **Do not push.** Print:
   - The release version/tag synced to.
   - The merge commit and the patch-apply commit hashes.
   - The status table from step 6.
   - A single concatenated checklist built from the `## Verify` section of
     every patch's `.md`, so the user has one place to look for smoke tests.

## Rules

- Never use `--force`, `--hard`, or any destructive flag. The drift-recovery
  branch in step 6 handles patch failures without rewriting history.
- Never push, open a PR, or run `gh` write commands. The user reviews and
  pushes themselves.
- If a patch's `.md` is missing or doesn't follow the format documented in
  `fork/patches/README.md`, stop and ask the user how to proceed.
- Run typecheck / lint only if the user asks; the verify checklist tells them
  what to run after reviewing.
