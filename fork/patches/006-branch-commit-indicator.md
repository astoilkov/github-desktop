# 006 — Branch commit indicator in history

## Goal

In the History tab, when a branch other than the default branch is checked
out, show which commits actually belong to that branch as opposed to history
inherited from the default branch. Branch-unique commits get a continuous
green accent line on the left edge of the commit list, so the point where the
branch "starts" is visible at a glance. The set is computed against both the
local default branch and its remote-tracking ref, so a stale local default
branch doesn't misattribute base-branch commits to the checked out branch.

## Upstream link

- None

## Touched files

- `app/src/lib/git/rev-list.ts` — `getCommitsInRange`.
- `app/src/lib/stores/git-store.ts` — new `loadBranchCommits` method and
  `branchCommitSHAs` getter next to `loadLocalCommits` / `localCommitSHAs`;
  new `_branchCommitSHAs` field; `getCommitsInRange` added to the `../git`
  import list.
- `app/src/lib/stores/app-store.ts` — `refreshHistorySection` and the
  repository state mapping in `onGitStoreUpdated`.
- `app/src/lib/app-state.ts` — `IRepositoryState`.
- `app/src/lib/stores/repository-state-cache.ts` — `getInitialRepositoryState`.
- `app/src/ui/repository.tsx` — `renderCompareSidebar`.
- `app/src/ui/history/compare.tsx` — `ICompareSidebarProps` and
  `renderCommitList` in `CompareSidebar`.
- `app/src/ui/history/commit-list.tsx` — `ICommitListProps`,
  `getRowCustomClassMap` (plus new `rowsForSHAs` helper), and the
  `invalidationProps` passed to `List` in `render`.
- `app/styles/ui/history/_commit-list.scss` — `.list-item.branch-commit`
  rule inside `#commit-list`.

## Change summary

- `rev-list.ts` — widen `getCommitsInRange` to also accept an array of
  rev-list revisions (e.g. `['feature', '^main', '^origin/main']`) so a range
  can exclude more than one ref; string callers are unchanged.
- `git-store.ts` — `loadBranchCommits(branch)` caches the SHAs of
  `git rev-list <branch> ^<defaultBranch> ^<defaultBranch upstream>`
  (upstream excluded only when the default branch has one) and exposes them
  via the `branchCommitSHAs` getter. Clears the cache when the default branch
  itself (or no branch) is checked out, or when there is no default branch.
- `app-store.ts` — `refreshHistorySection` recomputes the set alongside
  `loadLocalCommits` (so checkout, commit, fetch, pull, and tab switches keep
  it fresh); `onGitStoreUpdated` copies `gitStore.branchCommitSHAs` into
  `IRepositoryState`.
- `app-state.ts` / `repository-state-cache.ts` — new
  `IRepositoryState.branchCommitSHAs` field with `[]` as its initial value.
- `repository.tsx` / `compare.tsx` — thread `branchCommitSHAs` down to
  `CommitList`; `CompareSidebar` passes it only in History mode (in Compare
  mode the list already shows exactly the diverging commits).
- `commit-list.tsx` — new optional `branchCommitSHAs` prop;
  `getRowCustomClassMap` now assigns a `branch-commit` row class for those
  SHAs alongside the existing `highlighted` class, and the prop participates
  in the `List` `invalidationProps` so rows re-render when the set changes.
- `_commit-list.scss` — `.list-item.branch-commit::before` draws a 4px
  green (`--color-new`) overlay spanning the full row height, anchored to the
  absolutely-positioned row so it also covers the 1px border between items and
  consecutive branch commits read as one continuous line. Green was chosen
  over the tab-bar blue so it stays visible on the blue selection background.

## Verify

1. `yarn build:dev && yarn start`, open a repository, check out a branch that
   has its own commits on top of the default branch, and open the History tab.
2. The branch's own commits show an unbroken green line on the left edge —
   no gray border gaps between consecutive rows — while commits inherited
   from the default branch show none; the line stays visible on the selected
   (blue) row.
3. Check out the default branch itself: no green line anywhere.
4. Stale-default check: with the local default branch behind its remote
   (e.g. `git fetch` without updating local `development`), a branch that
   merged in newer `origin/development` commits must not mark those base
   commits green.

## Caveats

- The marker is only as fresh as the last fetch: commits that landed on the
  remote default branch but have never been fetched are unknown to git
  locally, so they show as branch commits until the next fetch.
- `findDefaultBranch` prefers the local default branch; the stale-ref
  problem is handled by additionally excluding its upstream tracking ref,
  not by switching the comparison base to the remote.
