# /sync-fork

**Rebase** the fork's own commits on top of the latest tagged GitHub Desktop
release. The fork branch is treated like a feature branch: every commit you've
made in this fork is replayed **on top**, and upstream's history (up to the
latest release tag) sits **below** it. There is no merge commit and no separate
"reapply patches" step — your real commits *are* the patches, so the rebase
replays them directly.

We deliberately rebase onto a released tag rather than the upstream branch HEAD
so the fork always tracks a shipped, stable version instead of unreleased
work-in-progress.

After the rebase, the `fork/patches/NNN-*.patch` files are regenerated from the
new baseline so the recorded diffs stay current (the matching `.md` remains the
source of truth for intent and is what guides conflict resolution), and
`yarn install` is run so the installed dependencies match the new release's
`package.json` / `yarn.lock`.

> **History is rewritten.** A rebase gives the replayed commits new hashes, so
> after this runs your local branch and `origin` will have diverged. Pushing
> afterward needs `git push --force-with-lease` (the command does **not** push —
> you review and push yourself). A backup ref is created first so the pre-rebase
> state is always recoverable.

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

3. Determine the **latest GitHub Desktop release tag** — this is the rebase
   target, not the upstream branch HEAD. Upstream tags releases as
   `release-X.Y.Z` (the same versions listed at
   https://github.com/desktop/desktop/tags). Pick the highest semantic version,
   ignoring pre-release/beta/draft tags if a stable one is higher:

   ```sh
   git tag -l 'release-*' --sort=-version:refname | head -20
   ```

   Take the first stable (non `-beta`/`-test`/`-draft`) tag as `<release-tag>`.
   If the most recent tags are ambiguous (e.g. a beta sorts above the latest
   stable, or naming doesn't match `release-*`), confirm the chosen tag with the
   user before rebasing. Record the resolved version for the final report.

4. **Already-synced check.** If the current branch already contains
   `<release-tag>` (`git merge-base --is-ancestor <release-tag> HEAD` exits 0),
   the fork's commits already sit on top of this release. Tell the user the fork
   is already in sync with the latest release and exit.

5. **Identify the fork's own commits** — the ones that will be replayed. These
   are everything since the current merge-base with the release tag:

   ```sh
   base=$(git merge-base <release-tag> HEAD)
   git log --oneline $base..HEAD          # the commits to be rebased
   git log --merges --oneline $base..HEAD # must be empty
   ```

   The rebase model expects a **linear** stack of fork commits (no merge
   commits among them). If `git log --merges $base..HEAD` is non-empty (e.g. an
   old "Sync with …" merge commit left over from the previous merge-based
   workflow), stop and ask the user how to proceed — flattening a merge during
   rebase can silently drop or duplicate changes.

6. **Create a safety backup ref** before rewriting history, so the pre-rebase
   state is always recoverable:

   ```sh
   git branch sync-fork-backup-$(git rev-parse --short HEAD) HEAD
   ```

   Record the old HEAD sha and this branch name for the final report. (If the
   backup branch already exists from a prior aborted run, reuse it.)

7. **Rebase the fork's commits onto the release tag:**

   ```sh
   git rebase <release-tag>
   ```

   This replays every fork-only commit on top of `<release-tag>` and drops the
   upstream commits that the tag already contains — leaving your commits on top
   and upstream below, exactly as desired.

   If a commit conflicts during replay, resolve it using the conflict-resolution
   methodology in the `/git-rebase-autofix` command (its **Context Gathering**
   and **Resolution Strategy** sections — gather full context from both sides,
   preserve the intent of each, don't blindly pick a side). To find intent:
   match the conflicting files against each patch's **Touched files** in
   `fork/patches/NNN-*.md` and read the matching `.md` (the `.md` is the source
   of truth, not the on-disk `.patch`). Re-implement the change against the new
   upstream code, stage it, and `git rebase --continue`. Report each replayed
   commit's status: `clean` or `resolved-conflict`.

   If a conflict's correct resolution isn't clear, ask the user before picking a
   side. If the user wants to bail out entirely, `git rebase --abort` restores
   the exact pre-rebase state.

8. **Regenerate the recorded patch diffs from the new baseline.** For each
   `fork/patches/NNN-*.md`, regenerate its `.patch` as the diff of that patch's
   **Touched files** between the release tag and the new HEAD:

   ```sh
   git diff <release-tag> HEAD -- <touched files from NNN-*.md> > fork/patches/NNN-<slug>.patch
   ```

   Most `.patch` files only change when upstream moved surrounding lines; that's
   expected. If **any** `.patch` file changed, create a single follow-up commit
   (do not amend the feature commits):
   `Refresh fork patches after syncing <release-tag>`.
   If none changed, skip this commit.

9. **Install dependencies.** The new release baseline may have moved
   `package.json` / `yarn.lock`, so refresh the installed modules:

   ```sh
   yarn install
   ```

   This is a working-tree operation only — it does not create a commit
   (`yarn.lock` is already part of the rebased history). Report whether it
   succeeded and surface any errors so the user knows the tree is buildable.

10. **Do not push.** Print:
   - The release version/tag rebased onto.
   - The old HEAD sha and the backup branch name (and how to recover:
     `git rebase --abort` mid-rebase, or `git reset --hard <backup>` after).
   - The new HEAD sha and the replayed-commit status table from step 7.
   - Which `.patch` files were regenerated (if any).
   - A single concatenated checklist built from the `## Verify` section of
     every patch's `.md`, so the user has one place to look for smoke tests.
   - A reminder that pushing requires `git push --force-with-lease` because the
     rebase rewrote history.

## Rules

- The rebase **intentionally** rewrites the fork's history — that is the whole
  point of this command. The step-6 backup ref makes it fully recoverable, and
  `git rebase --abort` restores the pre-rebase state at any time mid-rebase.
- Never `git reset --hard` away the user's work without the backup ref in place,
  and never force-push for the user — they review and push themselves.
- Never push, open a PR, or run `gh` write commands.
- If a patch's `.md` is missing or doesn't follow the format documented in
  `fork/patches/README.md`, stop and ask the user how to proceed.
- Run typecheck / lint only if the user asks; the verify checklist tells them
  what to run after reviewing.
